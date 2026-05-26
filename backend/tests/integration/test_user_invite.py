"""POST /users/invite + /users/accept-invite."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.security import create_invite_token


async def test_invite_and_accept_roundtrip(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    email = f"inv-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Inv",
            "last_name": "User",
            "role": "viewer",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["status"] == "pending_verification"
    assert body["user"]["email"] == email
    assert body["expires_in_days"] == 7
    token = body["invite_token"]

    # Wrong token → 400
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": "not-a-jwt", "password": "newpassword123"},
    )
    assert r.status_code == 400

    # Right token → 200 + status flips to active
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": token, "password": "newpassword123"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    # Replay rejected
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": token, "password": "anotherpass123"},
    )
    assert r.status_code == 409

    # And the new user can actually log in
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": "newpassword123"})
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()


async def test_invite_duplicate_email_409(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    # The seeded admin definitely exists
    me = (await api.get("/api/v1/auth/me", headers=auth_headers)).json()
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": me["email"],
            "first_name": "Dup",
            "last_name": "User",
            "role": "viewer",
        },
        headers=auth_headers,
    )
    assert r.status_code == 409


async def test_accept_invite_for_unknown_user_404(api: AsyncClient) -> None:
    token = create_invite_token(uuid.uuid4())
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": token, "password": "newpassword123"},
    )
    assert r.status_code == 404
