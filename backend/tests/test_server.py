"""Integration tests: real HTTP requests against the app running under
uvicorn, with the LiteLLM proxy replaced by the in-process mock."""

import os
import socket
import subprocess
import sys
from importlib.metadata import version as package_version
from urllib.parse import urlparse

import httpx

from conftest import CODE
from conftest import TEAM


def test_config_reports_url_and_version(server_base_url):
    response = httpx.get(f"{server_base_url}/config")
    assert response.status_code == 200
    body = response.json()
    assert body["litellm_url"] == os.environ["LITELLM_URL"]
    assert body["version"] == package_version("invite-litellm")


def test_serves_index_and_assets(server_base_url):
    for path in ("/", "/index.html", "/invite/a/b"):
        response = httpx.get(f"{server_base_url}{path}")
        assert response.status_code == 200
        assert "index" in response.text
    assert httpx.get(f"{server_base_url}/assets/app.css").status_code == 200


def test_spa_deep_links_fall_back_to_index(server_base_url):
    for path in ("/dashboard", "/keys/edit/abc"):
        response = httpx.get(f"{server_base_url}{path}")
        assert response.status_code == 200
        assert "index" in response.text


def test_missing_assets_stay_404(server_base_url):
    for path in ("/missing.js", "/favicon.ico"):
        assert httpx.get(f"{server_base_url}{path}").status_code == 404


def test_path_traversal_is_blocked(server_base_url):
    port = urlparse(server_base_url).port
    with socket.create_connection(("127.0.0.1", port), timeout=5) as sock:
        sock.sendall(b"GET /../etc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        status_line = sock.recv(256).decode().splitlines()[0]
    assert status_line == "HTTP/1.1 404 Not Found"


def test_invite_info_returns_team_name_and_budget(server_base_url):
    response = httpx.get(f"{server_base_url}/invite/{TEAM}/{CODE}/info")
    assert response.status_code == 200
    assert response.json() == {"team_name": "Research Team", "member_budget": 12.5}


def test_invite_info_without_alias_or_budget(server_base_url):
    response = httpx.get(f"{server_base_url}/invite/plain/PlainCod/info")
    assert response.status_code == 200
    assert response.json() == {"team_name": None, "member_budget": None}


def test_invite_info_rejects_bad_code(server_base_url):
    response = httpx.get(f"{server_base_url}/invite/{TEAM}/WrongCod/info")
    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid invite code"


def test_invite_info_unknown_team(server_base_url):
    assert httpx.get(f"{server_base_url}/invite/nope/{CODE}/info").status_code == 404


def test_invite_info_has_no_side_effects(server_base_url, mock_litellm):
    before = len(mock_litellm.permission_updates)
    httpx.get(f"{server_base_url}/invite/{TEAM}/{CODE}/info")
    assert len(mock_litellm.permission_updates) == before


def test_redeem_via_signup(server_base_url, mock_litellm):
    email = "ada@example.com"
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        json={"full_name": "Ada", "email": email, "password": "pw"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["key"].startswith("sk-gen-")
    assert body["team_id"] == TEAM

    user_id = mock_litellm.users[email]
    assert body["user_id"] == user_id

    payload = mock_litellm.generated_keys[-1]
    assert payload["user_id"] == user_id
    assert payload["team_id"] == TEAM
    assert payload["models"] == []
    assert payload["max_budget"] == 12.5
    assert payload["metadata"] == {"created_via": "invite"}
    assert mock_litellm.team_members[-1]["member"]["user_id"] == user_id

    # members must be granted key-management routes
    assert mock_litellm.permission_updates
    assert set(mock_litellm.permission_updates[-1]["team_member_permissions"]) >= {"/key/generate", "/key/delete"}


def test_new_users_are_created_with_zero_budget(server_base_url, mock_litellm):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        json={"full_name": "Bob", "email": "bob@example.com", "password": "pw"},
    )
    assert response.status_code == 200
    assert mock_litellm.created_users[-1]["max_budget"] == 0


def test_redeem_duplicate_email(server_base_url):
    payload = {"full_name": "Ada", "email": "dup@example.com", "password": "pw"}
    first = httpx.post(f"{server_base_url}/invite/{TEAM}/{CODE}", json=payload)
    assert first.status_code == 200
    second = httpx.post(f"{server_base_url}/invite/{TEAM}/{CODE}", json=payload)
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"]


def test_redeem_missing_fields(server_base_url):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        json={"full_name": "No Email"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing field: email"


def test_redeem_invalid_json(server_base_url):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid JSON body"


def test_redeem_without_account_or_session(server_base_url):
    response = httpx.post(f"{server_base_url}/invite/{TEAM}/{CODE}")
    assert response.status_code == 401
    assert "Sign in first" in response.json()["detail"]


def test_redeem_with_session_key(server_base_url, mock_litellm):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        headers={"Authorization": "Bearer fresh-key"},
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == "user-77"
    assert mock_litellm.generated_keys[-1]["user_id"] == "user-77"


def test_redeem_with_unknown_session_key(server_base_url):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        headers={"Authorization": "Bearer no-such-key"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid session key"


def test_redeem_when_user_already_has_team_key(server_base_url):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        headers={"Authorization": "Bearer sess-key"},
    )
    assert response.status_code == 409
    assert "already have a virtual key" in response.json()["detail"]


def test_redeem_bad_code(server_base_url):
    response = httpx.post(f"{server_base_url}/invite/{TEAM}/WrongCod", json={})
    assert response.status_code == 403


def test_redeem_unknown_team(server_base_url):
    response = httpx.post(
        f"{server_base_url}/invite/nope/{CODE}",
        json={"full_name": "a", "email": "x@y.z", "password": "pw"},
    )
    assert response.status_code == 404


def test_startup_fails_without_master_key(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "LITELLM_MASTER_KEY"}
    env["STATIC_DIR"] = str(tmp_path)
    env["PORT"] = "0"
    result = subprocess.run(
        [sys.executable, "-c", "from invite_litellm import main; main()"],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    assert "LITELLM_MASTER_KEY is not set" in result.stderr


def test_startup_fails_when_master_key_is_rejected(mock_litellm, tmp_path):
    env = dict(os.environ)
    env["LITELLM_URL"] = mock_litellm.url
    env["LITELLM_MASTER_KEY"] = "sk-wrong-key"
    env["STATIC_DIR"] = str(tmp_path)
    env["PORT"] = "0"
    result = subprocess.run(
        [sys.executable, "-c", "from invite_litellm import main; main()"],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    assert "did not accept LITELLM_MASTER_KEY" in result.stderr


def test_master_key_is_verified_at_startup(mock_litellm):
    """The session's server fixture itself proves it: it only starts when
    the master-key check passes against the (auth-enforcing) mock."""
    import httpx

    assert httpx.get(f"{mock_litellm.url}/health/liveliness").status_code == 200


def _signup(base, name, email):
    return httpx.post(
        f"{base}/invite/{TEAM}/{CODE}",
        json={"full_name": name, "email": email, "password": "pw"},
    )


def _bearer(base, key):
    return httpx.post(
        f"{base}/invite/{TEAM}/{CODE}",
        headers={"Authorization": f"Bearer {key}"},
    )


# --- upstream failure modes: the proxy misbehaving must become 502s
# with readable details, never an opaque crash.


def test_upstream_team_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/info"] = (500, {"error": {"message": "boom"}})
    response = httpx.get(f"{server_base_url}/invite/{TEAM}/{CODE}/info")
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "Could not read the team" in detail
    assert "boom" in detail


def test_upstream_team_info_non_json_body(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/info"] = (200, b"<html>gateway error</html>")
    response = httpx.get(f"{server_base_url}/invite/{TEAM}/{CODE}/info")
    assert response.status_code == 502
    assert response.json()["detail"] == "Unexpected team info response from the LiteLLM server"


def test_upstream_team_info_missing_team_info(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/info"] = (200, {"data": []})
    response = httpx.get(f"{server_base_url}/invite/{TEAM}/{CODE}/info")
    assert response.status_code == 502
    assert "Unexpected team info response" in response.json()["detail"]


def test_upstream_permissions_update_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/permissions_update"] = (500, {"detail": "denied"})
    response = _signup(server_base_url, "Ada", "permfail@example.com")
    assert response.status_code == 502
    assert "Could not grant key management permissions" in response.json()["detail"]


def test_upstream_user_new_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/new"] = (500, {"detail": "db down"})
    response = _signup(server_base_url, "Ada", "userfail@example.com")
    assert response.status_code == 502
    assert "Could not create the account" in response.json()["detail"]


def test_upstream_user_new_other_client_error(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/new"] = (400, {"detail": "invalid field"})
    response = _signup(server_base_url, "Ada", "userbad@example.com")
    assert response.status_code == 400
    assert response.json()["detail"] == "invalid field"


def test_upstream_user_new_missing_user_id(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/new"] = (200, {})
    response = _signup(server_base_url, "Ada", "nouserid@example.com")
    assert response.status_code == 502
    assert "did not return the new user id" in response.json()["detail"]


def test_upstream_user_update_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/update"] = (500, {"detail": "db down"})
    response = _signup(server_base_url, "Ada", "pwfail@example.com")
    assert response.status_code == 502
    assert "Could not set the account password" in response.json()["detail"]


def test_upstream_key_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/key/info"] = (500, {"detail": "db down"})
    response = _bearer(server_base_url, "fresh-key")
    assert response.status_code == 502
    assert "Could not look up the session key" in response.json()["detail"]


def test_upstream_key_info_missing_owner(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/key/info"] = (200, {"info": {}})
    response = _bearer(server_base_url, "fresh-key")
    assert response.status_code == 502
    assert "did not report an owner" in response.json()["detail"]


def test_upstream_key_list_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/key/list"] = (500, {"detail": "db down"})
    response = _bearer(server_base_url, "fresh-key")
    assert response.status_code == 502
    assert "Could not list existing keys" in response.json()["detail"]


def test_upstream_key_generate_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/key/generate"] = (500, {"detail": "db down"})
    response = _signup(server_base_url, "Ada", "genfail@example.com")
    assert response.status_code == 502
    assert "Could not create the virtual key" in response.json()["detail"]


def test_upstream_key_generate_missing_key(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/key/generate"] = (200, {})
    response = _signup(server_base_url, "Ada", "nokey@example.com")
    assert response.status_code == 502
    assert "did not return the new key" in response.json()["detail"]


# --- documented tolerance and pagination behaviors of the key walk


def test_member_add_already_in_team_is_tolerated(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/member_add"] = (
        400,
        {"detail": "User is already in team"},
    )
    response = _signup(server_base_url, "Ada", "already@example.com")
    assert response.status_code == 200


def test_member_add_other_failure_is_fatal(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/member_add"] = (
        400,
        {"detail": "team is full"},
    )
    response = _signup(server_base_url, "Ada", "teamfull@example.com")
    assert response.status_code == 502
    assert "Could not add the user to the team" in response.json()["detail"]


def test_key_walk_reads_every_page(server_base_url, mock_litellm):
    mock_litellm.key_list_pages = [
        [{"user_id": "someone-else", "team_id": TEAM}],
        [{"user_id": "user-77", "team_id": TEAM}],
    ]
    response = _bearer(server_base_url, "fresh-key")
    assert response.status_code == 409
    assert "already have a virtual key" in response.json()["detail"]


def test_key_walk_gives_up_after_20_pages(server_base_url, mock_litellm):
    mock_litellm.key_list_pages = [[] for _ in range(25)]
    response = _bearer(server_base_url, "fresh-key")
    assert response.status_code == 200


def test_key_list_invalid_shape_means_no_keys(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/key/list"] = (200, {"keys": "garbage", "total_pages": 1})
    response = _bearer(server_base_url, "fresh-key")
    assert response.status_code == 200


# --- misc edges


def test_json_array_body_rejected(server_base_url):
    response = httpx.post(
        f"{server_base_url}/invite/{TEAM}/{CODE}",
        content=b"[1, 2, 3]",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "The request body must be a JSON object"


def test_error_message_shapes(server_base_url):
    from invite_litellm.app import _error_message

    assert _error_message({"error": "plain"}, "fb") == "plain"
    assert _error_message({"error": {"message": "nested"}}, "fb") == "nested"
    assert _error_message({"detail": "string"}, "fb") == "string"
    assert _error_message({"detail": {"error": "det"}}, "fb") == "det"
    assert _error_message({"detail": {"message": "det msg"}}, "fb") == "det msg"
    assert _error_message({"message": "top"}, "fb") == "top"
    assert _error_message({"nothing": 1}, "fb") == "fb"
    assert _error_message(None, "fb") == "fb"
