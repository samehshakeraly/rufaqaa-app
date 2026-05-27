"""POST /auth/signup + /auth/verify-email + /auth/resend-verification."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import make_session
from app.models.donor import Donor
from app.models.user import User


async def test_signup_creates_donor_and_user(api: AsyncClient) -> None:
    email = f"signup-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "longenoughpw1",
            "full_name": "Test Donor",
            "country_code": "KW",
            "preferred_currency": "KWD",
            "preferred_language": "en",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "Check your inbox" in body["detail"] or "check your" in body["detail"].lower()
    assert body["debug_verify_token"]  # debug-mode

    # User + donor rows exist
    async with make_session() as db:
        u = await db.scalar(select(User).where(User.email == email))
        assert u is not None
        assert u.role == "donor"
        assert u.status == "pending_verification"
        assert u.email_verified_at is None
        d = await db.scalar(select(Donor).where(Donor.user_id == u.id))
        assert d is not None
        assert d.full_name == "Test Donor"
        assert d.country_of_residence == "KW"


async def test_signup_duplicate_email_returns_generic_shape(api: AsyncClient) -> None:
    """The body is the same shape and 201 either way — no enumeration."""
    email = f"dup-{uuid.uuid4().hex[:8]}@example.com"
    r1 = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "longenoughpw1", "full_name": "First"},
    )
    assert r1.status_code == 201, r1.text

    r2 = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "differentpw99", "full_name": "Second"},
    )
    assert r2.status_code == 201, r2.text
    # The second body does NOT include a debug_verify_token because we
    # didn't actually create a new user. The shape is identical to a caller.
    assert r2.json()["debug_verify_token"] is None


async def test_signup_weak_password_422(api: AsyncClient) -> None:
    r = await api.post(
        "/api/v1/auth/signup",
        json={
            "email": f"weak-{uuid.uuid4().hex[:8]}@example.com",
            "password": "short",
            "full_name": "Test",
        },
    )
    assert r.status_code == 422


async def test_verify_email_full_loop(api: AsyncClient) -> None:
    email = f"verify-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "longenoughpw1", "full_name": "Verify Me"},
    )
    token = r.json()["debug_verify_token"]

    # Bad token → 400
    r = await api.post("/api/v1/auth/verify-email", json={"token": "not-a-jwt"})
    assert r.status_code == 400

    # Real token → token pair + user becomes active + verified
    r = await api.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    pair = r.json()
    assert "access_token" in pair

    async with make_session() as db:
        u = await db.scalar(select(User).where(User.email == email))
        assert u is not None
        assert u.email_verified_at is not None
        assert u.status == "active"

    # Re-verifying is a no-op (still returns 200 + token pair, idempotent)
    r = await api.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200


async def test_resend_verification_generic_for_unknown_email(api: AsyncClient) -> None:
    r = await api.post(
        "/api/v1/auth/resend-verification",
        json={"email": "ghost@example.com"},
    )
    assert r.status_code == 200
    assert r.json()["debug_verify_token"] is None


async def test_resend_verification_works_for_pending_donor(api: AsyncClient) -> None:
    email = f"resend-{uuid.uuid4().hex[:8]}@example.com"
    await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "longenoughpw1", "full_name": "Pending"},
    )
    r = await api.post("/api/v1/auth/resend-verification", json={"email": email})
    assert r.status_code == 200
    assert r.json()["debug_verify_token"]  # fresh token issued
