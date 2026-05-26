"""GET/PATCH /organization."""

from __future__ import annotations

from httpx import AsyncClient


async def test_get_current_organization_returns_seed_org(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/organization", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["code"] == "DEV"
    assert body["country_code"] == "KW"
    for key in (
        "id",
        "name_ar",
        "name_en",
        "primary_color",
        "default_language",
        "default_currency",
    ):
        assert key in body


async def test_patch_organization_changes_settings(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # round-trip: set then read, then revert to keep other tests honest
    before = (await api.get("/api/v1/organization", headers=auth_headers)).json()
    original_color = before["primary_color"]
    original_lang = before["default_language"]

    r = await api.patch(
        "/api/v1/organization",
        json={"primary_color": "#123456", "default_language": "en"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["primary_color"] == "#123456"
    assert r.json()["default_language"] == "en"

    # Revert
    r = await api.patch(
        "/api/v1/organization",
        json={"primary_color": original_color, "default_language": original_lang},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_patch_rejects_bad_color(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.patch(
        "/api/v1/organization",
        json={"primary_color": "not-a-color"},
        headers=auth_headers,
    )
    assert r.status_code == 422
