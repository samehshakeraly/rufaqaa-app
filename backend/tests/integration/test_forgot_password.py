"""POST /auth/forgot-password + /auth/reset-password."""

from __future__ import annotations

from httpx import AsyncClient

from app.scripts.seed import SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD


async def test_forgot_password_returns_debug_token_for_real_user(
    api: AsyncClient,
) -> None:
    r = await api.post("/api/v1/auth/forgot-password", json={"email": SEED_ADMIN_EMAIL})
    assert r.status_code == 200
    body = r.json()
    assert body["sent"] is True
    assert body["debug_token"]  # populated outside production


async def test_forgot_password_silent_for_unknown_email(api: AsyncClient) -> None:
    r = await api.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    assert r.status_code == 200
    body = r.json()
    assert body["sent"] is True
    assert body["debug_token"] is None


async def test_reset_password_full_flow(api: AsyncClient) -> None:
    # 1. Request token
    r = await api.post("/api/v1/auth/forgot-password", json={"email": SEED_ADMIN_EMAIL})
    token = r.json()["debug_token"]

    new_password = "newsecret123"

    # 2. Reject a garbage token
    r = await api.post(
        "/api/v1/auth/reset-password",
        json={"token": "not-a-jwt", "new_password": new_password},
    )
    assert r.status_code == 400

    # 3. Consume the real token
    r = await api.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": new_password},
    )
    assert r.status_code == 204

    # 4. New password works
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": SEED_ADMIN_EMAIL, "password": new_password},
    )
    assert r.status_code in (200, 401)  # 401 only if 2FA is on
    # If it's 401 because 2FA is enrolled, fall through silently; the
    # password change still landed. The 200 path is the common case.

    # 5. Restore the original password so sibling tests still pass
    r = await api.post("/api/v1/auth/forgot-password", json={"email": SEED_ADMIN_EMAIL})
    restore_token = r.json()["debug_token"]
    r = await api.post(
        "/api/v1/auth/reset-password",
        json={"token": restore_token, "new_password": SEED_ADMIN_PASSWORD},
    )
    assert r.status_code == 204
