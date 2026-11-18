"""Shared fixtures: an in-process mock LiteLLM proxy and the real app
served by uvicorn on an ephemeral port, so tests exercise actual HTTP
requests against the server without needing a live proxy."""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qs
from urllib.parse import urlparse

import pytest

TEAM = "good"
CODE = "AbC123xy"


class MockLiteLLM:
    """Stateful stand-in for the LiteLLM admin API: just enough behavior
    (and recorded calls) to drive the invite endpoints end to end."""

    MASTER_KEY = "sk-test-master"

    def __init__(self):
        self.users = {}
        self.created_users = []
        self.generated_keys = []
        self.permission_updates = []
        self.team_members = []
        self.existing_keys = [{"token": "k1", "user_id": "user-42", "team_id": TEAM}]
        self.session_key_users = {"sess-key": "user-42", "fresh-key": "user-77"}
        self.server = None

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def _team_info(self, team_id):
        if team_id == TEAM:
            return {
                "team_id": TEAM,
                "team_alias": "Research Team",
                "metadata": {"invite_code": CODE},
                "team_member_budget_table": {"max_budget": 12.5},
                "team_member_permissions": [],
            }
        if team_id == "plain":
            return {
                "team_id": "plain",
                "metadata": {"invite_code": "PlainCod"},
            }
        return None

    def _handler(self):
        mock = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code, payload):
                body = json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                url = urlparse(self.path)
                if url.path == "/health/liveliness":
                    self._send(200, {"status": "healthy"})
                elif url.path == "/team/info":
                    team_id = parse_qs(url.query).get("team_id", [""])[0]
                    info = mock._team_info(team_id)
                    if info is None:
                        self._send(404, {"error": {"message": "Team not found"}})
                    else:
                        self._send(200, {"team_info": info})
                elif url.path == "/key/info":
                    key = parse_qs(url.query).get("key", [""])[0]
                    user_id = mock.session_key_users.get(key)
                    if user_id is None:
                        self._send(404, {"detail": "No keys found"})
                    else:
                        self._send(200, {"info": {"user_id": user_id}})
                elif url.path == "/key/list":
                    auth = self.headers.get("Authorization")
                    if auth != f"Bearer {mock.MASTER_KEY}":
                        self._send(401, {"detail": "Invalid proxy server token passed in"})
                    else:
                        self._send(200, {"keys": mock.existing_keys, "total_pages": 1})
                else:
                    self._send(404, {"detail": "not found"})

            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
                url = urlparse(self.path)
                if url.path == "/user/new":
                    data = json.loads(raw)
                    mock.created_users.append(data)
                    email = data.get("user_email", "")
                    if email in mock.users:
                        self._send(400, {"detail": f"User {email} already exists"})
                    else:
                        user_id = f"user-{len(mock.users) + 100}"
                        mock.users[email] = user_id
                        self._send(200, {"user_id": user_id})
                elif url.path == "/user/update":
                    self._send(200, {})
                elif url.path == "/team/member_add":
                    mock.team_members.append(json.loads(raw))
                    self._send(200, {})
                elif url.path == "/team/permissions_update":
                    mock.permission_updates.append(json.loads(raw))
                    self._send(200, {})
                elif url.path == "/key/generate":
                    mock.generated_keys.append(json.loads(raw))
                    self._send(200, {"key": f"sk-gen-{len(mock.generated_keys)}"})
                else:
                    self._send(404, {"detail": "not found"})

        return Handler


@pytest.fixture(scope="session")
def mock_litellm():
    mock = MockLiteLLM()
    mock.server = ThreadingHTTPServer(("127.0.0.1", 0), mock._handler())
    thread = threading.Thread(target=mock.server.serve_forever, daemon=True)
    thread.start()
    yield mock
    mock.server.shutdown()


@pytest.fixture(scope="session")
def server_base_url(tmp_path_factory, mock_litellm):
    static = tmp_path_factory.mktemp("static")
    (static / "index.html").write_text("<html>index</html>")
    assets = static / "assets"
    assets.mkdir()
    (assets / "app.css").write_text("body{}")

    # The app reads its configuration at import time, so the environment
    # must be in place before the first import of invite_litellm.app.
    os.environ["LITELLM_URL"] = mock_litellm.url
    os.environ["LITELLM_MASTER_KEY"] = mock_litellm.MASTER_KEY
    os.environ["STATIC_DIR"] = str(static)

    import uvicorn

    from invite_litellm.app import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started, "the test server did not start"
    port = server.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
