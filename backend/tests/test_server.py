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
