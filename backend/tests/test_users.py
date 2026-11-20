"""Integration tests for GET /users: display names for teammates, scoped
to the teams the signed-in caller belongs to (the proxy's /user/list is
admin-gated and cross-user /user/info is refused with 403, so members
resolve names through this backend route)."""

import httpx

from conftest import TEAM


def _get_users(server_base_url, bearer="sess-key", **kwargs):
    return httpx.get(
        f"{server_base_url}/users",
        headers={"Authorization": f"Bearer {bearer}"},
        **kwargs,
    )


def test_users_requires_authentication(server_base_url):
    assert httpx.get(f"{server_base_url}/users").status_code == 401


def test_users_rejects_unknown_key(server_base_url):
    response = _get_users(server_base_url, bearer="no-such-key")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid session key"


def test_users_resolves_teammate_alias(server_base_url):
    # user-42's team "good" counts user-88 as a member: its alias comes
    # back, without any other field of the user row.
    response = _get_users(server_base_url, params={"user_ids": "user-88"})
    assert response.status_code == 200
    assert response.json() == {
        "users": [
            {
                "user_id": "user-88",
                "user_alias": "Team Owner",
                "user_email": "owner@example.com",
            }
        ]
    }


def test_users_hides_non_teammates(server_base_url):
    # user-1 shares no team with user-42: the id is silently omitted
    # instead of leaking its existence.
    response = _get_users(server_base_url, params={"user_ids": "user-1"})
    assert response.status_code == 200
    assert response.json() == {"users": []}


def test_users_mixed_request_keeps_teammates_only(server_base_url):
    response = _get_users(
        server_base_url, params={"user_ids": "user-88,user-1,user-88"}
    )
    assert response.status_code == 200
    assert [user["user_id"] for user in response.json()["users"]] == ["user-88"]


def test_users_admin_bypasses_membership(server_base_url):
    # user-1 is a proxy_admin: anyone is resolvable.
    response = _get_users(server_base_url, bearer="admin-key", params={"user_ids": "user-88"})
    assert response.status_code == 200
    assert [user["user_id"] for user in response.json()["users"]] == ["user-88"]


def test_users_without_ids_returns_empty(server_base_url):
    response = _get_users(server_base_url, bearer="admin-key")
    assert response.status_code == 200
    assert response.json() == {"users": []}


def test_users_upstream_user_list_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/list"] = (500, {"error": {"message": "boom"}})
    response = _get_users(server_base_url, params={"user_ids": "user-88"})
    assert response.status_code == 502
    assert "boom" in response.json()["detail"]


def test_users_upstream_team_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/info"] = (500, {"detail": "down"})
    response = _get_users(server_base_url, params={"user_ids": "user-88"})
    assert response.status_code == 502
    assert "down" in response.json()["detail"]


def test_users_upstream_user_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/info"] = (500, {"detail": "nope"})
    response = _get_users(server_base_url, params={"user_ids": "user-88"})
    assert response.status_code == 502
    assert "nope" in response.json()["detail"]
