"""Integration tests for GET /models: authenticated, team-filtered model
list with cost metadata."""

import httpx

from conftest import TEAM

DEPLOYED = {"gpt-4o", "claude-3-5", "llama-3"}
RESTRICTED = {"gpt-4o", "claude-3-5", "gemini-pro"}


def _get_models(server_base_url, bearer="sess-key", **kwargs):
    return httpx.get(
        f"{server_base_url}/models",
        headers={"Authorization": f"Bearer {bearer}"},
        **kwargs,
    )


def test_models_requires_authentication(server_base_url):
    assert httpx.get(f"{server_base_url}/models").status_code == 401


def test_models_rejects_unknown_key(server_base_url):
    response = _get_models(server_base_url, bearer="no-such-key")
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid session key"


def test_models_limited_to_team_allowlist(server_base_url):
    # user-42 belongs to "good" only: models ["gpt-4o", "claude-3-5",
    # "gemini-pro"] — deployed ones keep their cost metadata, the
    # undeployed gemini-pro still shows up as a bare entry.
    response = _get_models(server_base_url, bearer="sess-key")
    assert response.status_code == 200
    entries = response.json()["data"]
    assert {entry["model_name"] for entry in entries} == RESTRICTED
    by_name = {entry["model_name"]: entry for entry in entries}
    assert by_name["gpt-4o"]["model_info"]["input_cost_per_token"] == 2.5e-6
    assert by_name["gpt-4o"]["model_info"]["output_cost_per_token"] == 1e-5
    assert "llama-3" not in by_name
    assert "model_info" not in by_name["gemini-pro"]


def test_models_unrestricted_team_shows_everything(server_base_url):
    # user-77 also belongs to "wide" (no models list) — one unrestricted
    # team opens the full deployment list.
    response = _get_models(server_base_url, bearer="fresh-key")
    assert response.status_code == 200
    assert {entry["model_name"] for entry in response.json()["data"]} == DEPLOYED


def test_models_all_proxy_models_wildcard_is_unrestricted(server_base_url):
    # user-99's only team allows just ["all-proxy-models"] — the wildcard
    # means every model.
    response = _get_models(server_base_url, bearer="wild-key")
    assert response.status_code == 200
    assert {entry["model_name"] for entry in response.json()["data"]} == DEPLOYED


def test_models_user_without_teams(server_base_url):
    response = _get_models(server_base_url, bearer="solo-key")
    assert response.status_code == 200
    assert response.json()["data"] == []


def test_models_team_filter_for_member(server_base_url):
    # user-77 belongs to both teams; asking for "good" narrows to its list.
    response = _get_models(server_base_url, bearer="fresh-key", params={"team_id": TEAM})
    assert response.status_code == 200
    assert {entry["model_name"] for entry in response.json()["data"]} == RESTRICTED


def test_models_team_filter_rejects_non_member(server_base_url):
    response = _get_models(server_base_url, bearer="sess-key", params={"team_id": "wide"})
    assert response.status_code == 403
    assert response.json()["detail"] == "You are not a member of this team"


def test_models_admin_sees_everything_without_teams(server_base_url):
    # user-1 is a proxy_admin in no team — the whole catalog anyway.
    response = _get_models(server_base_url, bearer="admin-key")
    assert response.status_code == 200
    assert {entry["model_name"] for entry in response.json()["data"]} == DEPLOYED


def test_models_admin_team_filter_skips_membership_check(server_base_url):
    # user-1 is not a member of "good" — admins may still narrow to it.
    response = _get_models(server_base_url, bearer="admin-key", params={"team_id": TEAM})
    assert response.status_code == 200
    assert {entry["model_name"] for entry in response.json()["data"]} == RESTRICTED


def test_models_upstream_model_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/model/info"] = (500, {"error": {"message": "boom"}})
    response = _get_models(server_base_url, bearer="sess-key")
    assert response.status_code == 502
    assert "boom" in response.json()["detail"]


def test_models_upstream_user_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/user/info"] = (500, {"detail": "nope"})
    response = _get_models(server_base_url, bearer="sess-key")
    assert response.status_code == 502
    assert "nope" in response.json()["detail"]


def test_models_upstream_team_info_failure(server_base_url, mock_litellm):
    mock_litellm.upstream_overrides["/team/info"] = (500, {"detail": "down"})
    response = _get_models(server_base_url, bearer="sess-key")
    assert response.status_code == 502
    assert "down" in response.json()["detail"]
