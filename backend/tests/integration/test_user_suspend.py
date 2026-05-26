"""POST /users/{id}/suspend + /reactivate."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User


async def _create_throwaway_user() -> str:
    """Create a fresh user we can safely suspend without locking the
    test admin out. Returns the user's id."""
    async with make_session() as db:
        org = await db.scalar(select(Organization).where(Organization.code == "DEV"))
        assert org is not None
        u = User(
            organization_id=org.id,
            email=f"susp-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("temppassword123"),
            first_name="susp",
            last_name="test",
            role="viewer",
            status="active",
        )
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return str(u.id)


async def test_suspend_and_reactivate_roundtrip(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    uid = await _create_throwaway_user()

    r = await api.post(f"/api/v1/users/{uid}/suspend", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "suspended"

    # Re-suspending is a no-op (returns 200 + current state)
    r = await api.post(f"/api/v1/users/{uid}/suspend", headers=auth_headers)
    assert r.status_code == 200

    # Reactivating an active user is rejected (409)
    r = await api.post(f"/api/v1/users/{uid}/reactivate", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "active"

    # Trying to reactivate an active user → 409
    r2 = await api.post(f"/api/v1/users/{uid}/reactivate", headers=auth_headers)
    assert r2.status_code == 409


async def test_cannot_suspend_self(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    me = (await api.get("/api/v1/auth/me", headers=auth_headers)).json()
    r = await api.post(f"/api/v1/users/{me['id']}/suspend", headers=auth_headers)
    assert r.status_code == 400


async def test_suspend_unknown_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.post(f"/api/v1/users/{uuid.uuid4()}/suspend", headers=auth_headers)
    assert r.status_code == 404
    # Keep ruff happy about the unused import warning
    _ = update  # noqa: F841 (kept for parity with sibling test files)
