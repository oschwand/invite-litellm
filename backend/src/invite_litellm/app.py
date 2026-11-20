"""Static file server and invite backend for the invite-litellm frontend build."""

import json
import logging
import os
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _package_version
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

_PROJECT_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(_PROJECT_ROOT / ".env")

_STATIC_ROOT = Path(os.environ.get("STATIC_DIR", _PROJECT_ROOT / "frontend" / "dist")).resolve()

_LITELLM_URL = os.environ.get("LITELLM_URL", "http://localhost:4000").rstrip("/")
_LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
try:
    _VERSION = _package_version("invite-litellm")
except PackageNotFoundError:
    _VERSION = "unknown"
_MEMBER_PERMISSIONS = ("/key/generate", "/key/delete")
_ALL_PROXY_MODELS = "all-proxy-models"
# Roles for which no team restriction applies (mirrors the SPA's
# isAdminRole allow-list; anything else counts as a regular member).
_ADMIN_ROLES = ("admin", "proxy_admin", "proxy_admin_viewer", "org_admin")

_client = httpx.AsyncClient(base_url=_LITELLM_URL, timeout=30.0)

_logger = logging.getLogger(__name__)
if not _logger.handlers:
    _log_handler = logging.StreamHandler()
    _log_handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
    _logger.addHandler(_log_handler)
    _logger.setLevel(logging.INFO)


def _require_master_key() -> None:
    """Fail fast when the master key is missing: a server that starts
    happily only to answer 503 on every invite request hides the
    misconfiguration until someone tries to redeem a link."""
    if not _LITELLM_MASTER_KEY.strip():
        raise RuntimeError(
            "LITELLM_MASTER_KEY is not set — invite redemption cannot work. "
            "Pass it as an environment variable or put it in backend/.env."
        )


async def _check_litellm_reachable() -> bool:
    try:
        await _client.get("/health/liveliness", timeout=5.0)
    except httpx.HTTPError:
        _logger.warning(
            "Cannot reach the LiteLLM server at %s — check that it is running. Invite redemption will fail until it is back.",
            _LITELLM_URL,
        )
        return False
    _logger.info("LiteLLM server at %s is reachable", _LITELLM_URL)
    return True


async def _verify_master_key() -> None:
    """The proxy is up — the master key must actually authenticate. Any
    non-200 answer is a hard startup failure: an unverifiable or wrong
    key is as broken for invite redemption as no proxy at all."""
    status, body = await _litellm("GET", "/key/list", params={"size": "1"})
    if status == 200:
        _logger.info("The master key was accepted by the LiteLLM server")
        return
    raise RuntimeError(
        f"The LiteLLM server at {_LITELLM_URL} did not accept LITELLM_MASTER_KEY "
        f"(HTTP {status}: {_error_message(body, 'unauthorized')}) — check the key value."
    )


@asynccontextmanager
async def _lifespan(_: FastAPI):
    _require_master_key()
    if await _check_litellm_reachable():
        await _verify_master_key()
    yield
    await _client.aclose()


app = FastAPI(title="invite-litellm", lifespan=_lifespan)


def _index_response() -> FileResponse:
    index = _STATIC_ROOT / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


@app.get("/invite/{team_id}/{invite_code}")
async def invite(team_id: str, invite_code: str) -> FileResponse:
    del team_id, invite_code
    return _index_response()


async def _litellm(method: str, path: str, *, json_body: dict[str, Any] | None = None, params: dict[str, str] | None = None) -> tuple[int, Any]:
    response = await _client.request(
        method,
        path,
        json=json_body,
        params=params,
        headers={"Authorization": f"Bearer {_LITELLM_MASTER_KEY}"},
    )
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    return response.status_code, body


def _error_message(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, str):
            return error
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        detail = body.get("detail")
        if isinstance(detail, str):
            return detail
        if isinstance(detail, dict):
            for field in ("message", "error"):
                if isinstance(detail.get(field), str):
                    return detail[field]
        if isinstance(body.get("message"), str):
            return body["message"]
    return fallback


async def _team_info_for_invite(team_id: str, invite_key: str) -> dict[str, Any]:
    """Fetch the team from the LiteLLM server and validate its invite code.

    Raises 404 (unknown team), 403 (bad code) or 502 (upstream failure);
    returns the team_info object on success.
    """
    status, body = await _litellm("GET", "/team/info", params={"team_id": team_id})
    if status == 404:
        raise HTTPException(status_code=404, detail="Team not found")
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not read the team from the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    info = body.get("team_info") if isinstance(body, dict) else None
    if not isinstance(info, dict):
        raise HTTPException(status_code=502, detail="Unexpected team info response from the LiteLLM server")
    metadata = info.get("metadata")
    stored_code = metadata.get("invite_code") if isinstance(metadata, dict) else None
    if not isinstance(stored_code, str) or stored_code != invite_key:
        raise HTTPException(status_code=403, detail="Invalid invite code")
    return info


def _member_budget(info: dict[str, Any]) -> float | None:
    budget_table = info.get("team_member_budget_table")
    max_budget = budget_table.get("max_budget") if isinstance(budget_table, dict) else None
    return max_budget if isinstance(max_budget, (int, float)) else None


def _team_alias(info: dict[str, Any]) -> str | None:
    alias = info.get("team_alias")
    return alias if isinstance(alias, str) and alias != "" else None


async def _check_invite(team_id: str, invite_key: str) -> float | None:
    """Validate the invite code; return the team member budget for the new key."""
    info = await _team_info_for_invite(team_id, invite_key)

    current = info.get("team_member_permissions")
    existing = {route for route in current if isinstance(route, str)} if isinstance(current, list) else set()
    missing = [route for route in _MEMBER_PERMISSIONS if route not in existing]
    if missing:
        status, body = await _litellm(
            "POST",
            "/team/permissions_update",
            json_body={"team_id": team_id, "team_member_permissions": sorted(existing | set(_MEMBER_PERMISSIONS))},
        )
        if status != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Could not grant key management permissions to team members: {_error_message(body, f'HTTP {status}')}",
            )
    return _member_budget(info)


def _bearer_token(request: Request) -> str:
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return ""
    return authorization.removeprefix("Bearer ").strip()


async def _user_id_from_key(api_key: str) -> str:
    status, body = await _litellm("GET", "/key/info", params={"key": api_key})
    if status in (401, 404):
        raise HTTPException(status_code=401, detail="Invalid session key")
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not look up the session key on the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    info = body.get("info") if isinstance(body, dict) else None
    user_id = info.get("user_id") if isinstance(info, dict) else None
    if not isinstance(user_id, str) or user_id == "":
        raise HTTPException(status_code=502, detail="The LiteLLM server did not report an owner for this key")
    return user_id


def _parse_account(raw: bytes) -> dict[str, str]:
    if not raw:
        raise HTTPException(status_code=401, detail="Sign in first, or provide an account (full_name, email, password) to accept this invite")
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="The request body must be a JSON object")
    account: dict[str, str] = {}
    for field in ("full_name", "email", "password"):
        value = data.get(field)
        if not isinstance(value, str) or value.strip() == "":
            raise HTTPException(status_code=400, detail=f"Missing field: {field}")
        account[field] = value.strip()
    return account


async def _create_user(account: dict[str, str]) -> str:
    status, body = await _litellm(
        "POST",
        "/user/new",
        json_body={
            "user_email": account["email"],
            "user_alias": account["full_name"],
            "user_role": "internal_user",
            "auto_create_key": False,
            # No personal budget: spending is governed by the team key the
            # invite issues, and without this the proxy may apply its own
            # default user budget.
            "max_budget": 0,
        },
    )
    if status in (400, 409):
        message = _error_message(body, "The account could not be created")
        if "already exists" in message.lower():
            raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in with it instead")
        raise HTTPException(status_code=400, detail=message)
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not create the account on the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    user_id = body.get("user_id") if isinstance(body, dict) else None
    if not isinstance(user_id, str) or user_id == "":
        raise HTTPException(status_code=502, detail="The LiteLLM server did not return the new user id")
    status, body = await _litellm("POST", "/user/update", json_body={"user_id": user_id, "password": account["password"]})
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not set the account password on the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    return user_id


async def _add_team_member(team_id: str, user_id: str) -> None:
    status, body = await _litellm(
        "POST",
        "/team/member_add",
        json_body={"team_id": team_id, "member": {"user_id": user_id, "role": "user"}},
    )
    if status == 200:
        return
    message = _error_message(body, f"HTTP {status}")
    if "already" in message.lower():
        return
    raise HTTPException(status_code=502, detail=f"Could not add the user to the team: {message}")


async def _user_team_key_exists(team_id: str, user_id: str) -> bool:
    page = 1
    while page <= 20:
        status, body = await _litellm(
            "GET",
            "/key/list",
            params={"return_full_object": "true", "size": "100", "page": str(page)},
        )
        if status != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Could not list existing keys on the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
            )
        keys = body.get("keys") if isinstance(body, dict) else None
        if not isinstance(keys, list):
            return False
        for entry in keys:
            if (
                isinstance(entry, dict)
                and entry.get("user_id") == user_id
                and entry.get("team_id") == team_id
            ):
                return True
        total_pages = body.get("total_pages") if isinstance(body, dict) else None
        if not isinstance(total_pages, int) or page >= total_pages:
            return False
        page += 1
    return False


async def _create_team_key(team_id: str, user_id: str, max_budget: float | None) -> str:
    payload: dict[str, Any] = {
        "team_id": team_id,
        "user_id": user_id,
        "models": [],
        "metadata": {"created_via": "invite"},
    }
    if max_budget is not None:
        payload["max_budget"] = max_budget
    status, body = await _litellm("POST", "/key/generate", json_body=payload)
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not create the virtual key on the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    key = body.get("key") if isinstance(body, dict) else None
    if not isinstance(key, str) or key == "":
        raise HTTPException(status_code=502, detail="The LiteLLM server did not return the new key")
    return key


@app.post("/invite/{team_id}/{invite_key}")
async def redeem_invite(team_id: str, invite_key: str, request: Request) -> dict[str, Any]:
    if not _LITELLM_MASTER_KEY:
        raise HTTPException(status_code=503, detail="Invite backend is not configured: set LITELLM_MASTER_KEY")
    member_budget = await _check_invite(team_id, invite_key)

    bearer = _bearer_token(request)
    if bearer != "":
        user_id = await _user_id_from_key(bearer)
    else:
        user_id = await _create_user(_parse_account(await request.body()))

    if await _user_team_key_exists(team_id, user_id):
        raise HTTPException(
            status_code=409,
            detail="You already have a virtual key for this team. Sign in and reuse it, or regenerate it from the key list.",
        )

    await _add_team_member(team_id, user_id)
    key = await _create_team_key(team_id, user_id, member_budget)
    return {"key": key, "user_id": user_id, "team_id": team_id}


@app.get("/invite/{team_id}/{invite_code}/info")
async def invite_info(team_id: str, invite_code: str) -> dict[str, Any]:
    """Team name and member budget for the invite page — needs no session:
    validation runs with the master key, so anonymous invitees see a real
    team name instead of the raw id (LiteLLM's /team/info is admin-gated)."""
    if not _LITELLM_MASTER_KEY:
        raise HTTPException(status_code=503, detail="Invite backend is not configured: set LITELLM_MASTER_KEY")
    info = await _team_info_for_invite(team_id, invite_code)
    return {"team_name": _team_alias(info), "member_budget": _member_budget(info)}


@app.get("/config")
async def config() -> dict[str, str]:
    return {"litellm_url": _LITELLM_URL, "version": _VERSION}


async def _user_info(user_id: str) -> dict[str, Any]:
    """The user's /user/info record — teams (ids) and role come from it."""
    status, body = await _litellm("GET", "/user/info", params={"user_id": user_id})
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not read the user's teams from the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    info = body.get("user_info") if isinstance(body, dict) else None
    if not isinstance(info, dict):
        raise HTTPException(status_code=502, detail="Unexpected user info response from the LiteLLM server")
    return info


def _team_allowed_models(info: dict[str, Any]) -> list[str] | None:
    """The team's allowed-models list, or None when the team is unrestricted
    (no list, an empty list, or just the all-proxy-models wildcard)."""
    models = info.get("models")
    if not isinstance(models, list):
        return None
    names = {name for name in models if isinstance(name, str) and name != ""}
    if not names or names == {_ALL_PROXY_MODELS}:
        return None
    return sorted(names)


async def _allowed_model_names(team_ids: list[str]) -> list[str] | None:
    """Union of the teams' allowed-models lists; None when any of the teams
    is unrestricted (= every deployed model is allowed)."""
    allowed: set[str] = set()
    for team_id in team_ids:
        status, body = await _litellm("GET", "/team/info", params={"team_id": team_id})
        if status != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Could not read the team {team_id} from the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
            )
        info = body.get("team_info") if isinstance(body, dict) else None
        if not isinstance(info, dict):
            raise HTTPException(status_code=502, detail=f"Unexpected team info response from the LiteLLM server for team {team_id}")
        models = _team_allowed_models(info)
        if models is None:
            return None
        allowed.update(models)
    return sorted(allowed)


@app.get("/models")
async def list_models(request: Request) -> dict[str, Any]:
    """Model deployments with their cost metadata, limited to what the
    signed-in user's teams allow — /model/info is admin-gated on the proxy
    (internal users get no pricing), so the master key fetches the full list
    and this route narrows it per caller. Admin-tier callers get the whole
    catalog (their team restriction is vacuous — the proxy answers them
    everywhere anyway). An optional ?team_id= restricts the view to one
    team (members only, admins exempt)."""
    if not _LITELLM_MASTER_KEY:
        raise HTTPException(status_code=503, detail="Invite backend is not configured: set LITELLM_MASTER_KEY")
    bearer = _bearer_token(request)
    if bearer == "":
        raise HTTPException(status_code=401, detail="Sign in to list the models available to your teams")
    user_id = await _user_id_from_key(bearer)

    info = await _user_info(user_id)
    role = info.get("user_role")
    admin = isinstance(role, str) and role in _ADMIN_ROLES
    teams = info.get("teams")
    team_ids = (
        [team for team in teams if isinstance(team, str) and team != ""]
        if isinstance(teams, list)
        else []
    )

    requested_team = request.query_params.get("team_id", "")
    allowed: list[str] | None
    if admin:
        # No restriction unless one team was asked for explicitly.
        allowed = (
            await _allowed_model_names([requested_team])
            if requested_team != ""
            else None
        )
    else:
        if requested_team != "" and requested_team not in team_ids:
            raise HTTPException(status_code=403, detail="You are not a member of this team")
        allowed = await _allowed_model_names(
            [requested_team] if requested_team != "" else team_ids
        )

    status, body = await _litellm("GET", "/model/info")
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not list the models on the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    deployments = body.get("data") if isinstance(body, dict) else None
    if not isinstance(deployments, list):
        raise HTTPException(status_code=502, detail="Unexpected model info response from the LiteLLM server")

    models: list[Any] = []
    for entry in deployments:
        if allowed is None or (isinstance(entry, dict) and entry.get("model_name") in allowed):
            models.append(entry)
    if allowed is not None:
        # Models the teams allow but the proxy does not deploy still show up
        # (without pricing), like the /models view of the SPA.
        known = {entry.get("model_name") for entry in models if isinstance(entry, dict)}
        models.extend({"model_name": name} for name in allowed if name not in known)
    return {"data": models}


async def _team_member_ids(team_id: str) -> set[str]:
    """User ids of one team's members (members_with_roles)."""
    status, body = await _litellm("GET", "/team/info", params={"team_id": team_id})
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not read the team {team_id} from the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    info = body.get("team_info") if isinstance(body, dict) else None
    if not isinstance(info, dict):
        raise HTTPException(status_code=502, detail=f"Unexpected team info response from the LiteLLM server for team {team_id}")
    members = info.get("members_with_roles")
    ids: set[str] = set()
    if isinstance(members, list):
        for member in members:
            member_id = member.get("user_id") if isinstance(member, dict) else None
            if isinstance(member_id, str) and member_id != "":
                ids.add(member_id)
    return ids


@app.get("/users")
async def list_users(request: Request) -> dict[str, Any]:
    """Display names (alias, fallback email) for the requested user ids —
    but only for users sharing a team with the signed-in caller. The proxy
    gates /user/list behind admin rights and refuses cross-user /user/info
    (403 "key not allowed to access this user's info"), so team members
    have no way to resolve their teammates' names; the master key fetches
    them here and the co-membership check keeps this from becoming a
    directory of every user. Admin-tier callers may look anyone up, like
    the proxy answers them everywhere."""
    if not _LITELLM_MASTER_KEY:
        raise HTTPException(status_code=503, detail="Invite backend is not configured: set LITELLM_MASTER_KEY")
    bearer = _bearer_token(request)
    if bearer == "":
        raise HTTPException(status_code=401, detail="Sign in to look up user names")
    user_id = await _user_id_from_key(bearer)

    requested = list(
        dict.fromkeys(
            user for user in request.query_params.get("user_ids", "").split(",") if user != ""
        )
    )
    if not requested:
        return {"users": []}

    info = await _user_info(user_id)
    role = info.get("user_role")
    admin = isinstance(role, str) and role in _ADMIN_ROLES
    if not admin:
        teams = info.get("teams")
        team_ids = (
            [team for team in teams if isinstance(team, str) and team != ""]
            if isinstance(teams, list)
            else []
        )
        co_members: set[str] = set()
        for team_id in team_ids:
            co_members |= await _team_member_ids(team_id)
        requested = [user for user in requested if user in co_members]
        if not requested:
            return {"users": []}

    status, body = await _litellm("GET", "/user/list", params={"user_ids": ",".join(requested)})
    if status != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Could not read the users from the LiteLLM server: {_error_message(body, f'HTTP {status}')}",
        )
    users = body.get("users") if isinstance(body, dict) else None
    if not isinstance(users, list):
        raise HTTPException(status_code=502, detail="Unexpected user list response from the LiteLLM server")
    return {
        "users": [
            {
                "user_id": entry.get("user_id"),
                "user_alias": entry.get("user_alias"),
                "user_email": entry.get("user_email"),
            }
            for entry in users
            if isinstance(entry, dict) and isinstance(entry.get("user_id"), str) and entry.get("user_id") != ""
        ]
    }


@app.get("/{file_path:path}")
async def serve_static(file_path: str) -> FileResponse:
    if file_path in ("", "index.html"):
        return _index_response()
    target = (_STATIC_ROOT / file_path).resolve()
    if not target.is_relative_to(_STATIC_ROOT):
        raise HTTPException(status_code=404, detail="Not found")
    if target.is_file():
        return FileResponse(target)
    # Unknown extensionless paths are SPA routes (/dashboard, /keys, …):
    # serve the shell so client-side routing survives hard loads and
    # refreshes. Missing assets keep their 404.
    if target.suffix == "":
        return _index_response()
    raise HTTPException(status_code=404, detail="Not found")
