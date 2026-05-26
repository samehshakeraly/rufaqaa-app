"""GET /auth/me + PATCH /auth/me/notifications."""

from __future__ import annotations

from httpx import AsyncClient


async def test_me_returns_default_prefs(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get("/api/v1/auth/me", headers=auth_headers)
    assert r.status_code == 200
    prefs = r.json()["notification_preferences"]
    # Defaults from the schema
    assert prefs == {
        "email": True,
        "sms": False,
        "whatsapp": False,
        "weekly_digest": True,
        "marketing": False,
    }


async def test_patch_prefs_is_partial(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # Flip whatsapp on, leave the rest alone
    r = await api.patch(
        "/api/v1/auth/me/notifications",
        json={"whatsapp": True, "weekly_digest": False},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["whatsapp"] is True
    assert body["weekly_digest"] is False
    assert body["email"] is True  # untouched

    # Re-read /me — the change persisted
    r = await api.get("/api/v1/auth/me", headers=auth_headers)
    assert r.json()["notification_preferences"]["whatsapp"] is True

    # Reset to a known state so we don't leak into sibling tests
    r = await api.patch(
        "/api/v1/auth/me/notifications",
        json={"whatsapp": False, "weekly_digest": True},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_patch_prefs_requires_auth(api: AsyncClient) -> None:
    r = await api.patch("/api/v1/auth/me/notifications", json={"email": False})
    assert r.status_code == 401
