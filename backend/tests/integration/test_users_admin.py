"""Admin list of users."""

from __future__ import annotations

from httpx import AsyncClient


async def test_list_users_returns_admin_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/users?limit=5", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1  # the seed admin lives here
    for item in body["items"]:
        # Never expose sensitive auth state through this surface.
        assert "password_hash" not in item
        assert "two_factor_secret" not in item
        # Required keys.
        for key in (
            "id",
            "email",
            "role",
            "status",
            "two_factor_enabled",
            "created_at",
        ):
            assert key in item


async def test_list_users_filter_by_role(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/users?role=org_admin", headers=auth_headers)
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["role"] == "org_admin"
