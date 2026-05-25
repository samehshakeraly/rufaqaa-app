"""Auth hardening: refresh-token rotation, account lockout, password change."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.database import make_session
from app.core.security import hash_password
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL


async def _reset_admin_password(password: str) -> None:
    """Reset the seed admin so we can mess with the lockout state safely."""
    async with make_session() as db:
        await db.execute(
            update(User)
            .where(User.email == SEED_ADMIN_EMAIL)
            .values(
                password_hash=hash_password(password),
                failed_login_attempts=0,
                locked_until=None,
                status="active",
            )
        )
        await db.commit()


async def _login(api: AsyncClient, email: str, password: str) -> int:
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    return r.status_code


async def test_refresh_rotation_revokes_old_token(api: AsyncClient) -> None:
    await _reset_admin_password("admin12345")
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": SEED_ADMIN_EMAIL, "password": "admin12345"},
    )
    assert r.status_code == 200
    first = r.json()["refresh_token"]

    # First refresh — succeeds and returns a NEW refresh token
    r2 = await api.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert r2.status_code == 200, r2.text
    second = r2.json()["refresh_token"]
    assert second != first

    # Replaying the original refresh is rejected (rotation)
    r3 = await api.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert r3.status_code == 401

    # The new refresh still works
    r4 = await api.post("/api/v1/auth/refresh", json={"refresh_token": second})
    assert r4.status_code == 200


async def test_logout_revokes_refresh(api: AsyncClient) -> None:
    await _reset_admin_password("admin12345")
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": SEED_ADMIN_EMAIL, "password": "admin12345"},
    )
    refresh = r.json()["refresh_token"]

    r = await api.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert r.status_code == 204

    r = await api.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 401


async def test_account_lockout_after_repeated_failures(api: AsyncClient) -> None:
    await _reset_admin_password("admin12345")

    # 5 wrong attempts trip the lockout
    for _ in range(5):
        assert await _login(api, SEED_ADMIN_EMAIL, "wrongpass1") == 401

    # The user is now locked, even with the correct password
    assert await _login(api, SEED_ADMIN_EMAIL, "admin12345") == 401

    async with make_session() as db:
        user = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert user is not None
        assert user.locked_until is not None
        assert user.locked_until > datetime.now(UTC)

    # Unlock manually so other tests can still log in
    async with make_session() as db:
        await db.execute(
            update(User)
            .where(User.email == SEED_ADMIN_EMAIL)
            .values(locked_until=datetime.now(UTC) - timedelta(minutes=1)),
        )
        await db.commit()
    assert await _login(api, SEED_ADMIN_EMAIL, "admin12345") == 200


async def test_change_password_revokes_all_sessions(api: AsyncClient) -> None:
    await _reset_admin_password("admin12345")
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": SEED_ADMIN_EMAIL, "password": "admin12345"},
    )
    access = r.json()["access_token"]
    refresh = r.json()["refresh_token"]
    h = {"Authorization": f"Bearer {access}"}

    new_pw = "fresh-secret-99"
    r = await api.post(
        "/api/v1/auth/change-password",
        json={"current_password": "admin12345", "new_password": new_pw},
        headers=h,
    )
    assert r.status_code == 204

    # Old refresh is dead
    r = await api.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 401

    # Login with old password fails
    assert await _login(api, SEED_ADMIN_EMAIL, "admin12345") == 401
    # Login with new password works
    assert await _login(api, SEED_ADMIN_EMAIL, new_pw) == 200

    # Restore for other tests
    await _reset_admin_password("admin12345")


async def test_change_password_requires_current(api: AsyncClient) -> None:
    await _reset_admin_password("admin12345")
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": SEED_ADMIN_EMAIL, "password": "admin12345"},
    )
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = await api.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong-current", "new_password": "totally-new-x9"},
        headers=h,
    )
    assert r.status_code == 400
