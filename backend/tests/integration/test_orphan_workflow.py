"""POST /orphans/{id}/approve|reject|release — case-status workflow."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> str:
    """Create a fresh orphan in pending_review (the default case_status)."""
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"موافقة-{suffix}",
            "family_name": "اختبار",
            "date_of_birth": "2016-03-12",
            "gender": "M",
            "nationality": "KW",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _login_as_partner_staff(
    api: AsyncClient, auth_headers: dict[str, str]
) -> dict[str, str]:
    """Invite a partner_staff user, accept, log in. Returns auth headers."""
    email = f"ps-{uuid.uuid4().hex[:8]}@example.com"
    password = "staffpass1234"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Partner",
            "last_name": "Staff",
            "role": "partner_staff",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    token = r.json()["invite_token"]
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": token, "password": password},
    )
    assert r.status_code == 200, r.text
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── approve ────────────────────────────────────────────────────────────


async def test_approve_pending_orphan(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/approve",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["case_status"] == "approved"

    # Re-fetch to confirm persistence (approved_by_partner_at isn't in
    # OrphanRead, so we read directly from the DB instead).
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT approved_by_partner_at, approved_by_partner_user_id "
                    "FROM orphans WHERE id = :id"
                ),
                {"id": orphan_id},
            )
        ).first()
        assert row is not None
        assert row[0] is not None  # timestamp filled in
        assert row[1] is not None  # actor recorded


async def test_approve_wrong_state_409(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    # First approve succeeds.
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/approve",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 200

    # Second approve from `approved` is illegal.
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/approve",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 409


async def test_partner_staff_cannot_approve_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    staff_headers = await _login_as_partner_staff(api, auth_headers)

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/approve",
        json={},
        headers=staff_headers,
    )
    assert r.status_code == 403


# ── reject ─────────────────────────────────────────────────────────────


async def test_reject_records_reason(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/reject",
        json={"reason": "incomplete documents"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["case_status"] == "rejected"

    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT rejection_reason FROM orphans WHERE id = :id"),
                {"id": orphan_id},
            )
        ).first()
        assert row is not None
        assert row[0] == "incomplete documents"


async def test_reject_requires_reason(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/reject",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 422


async def test_reject_wrong_state_409(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    # Approve first → cannot reject from approved.
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/approve",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 200
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/reject",
        json={"reason": "too late"},
        headers=auth_headers,
    )
    assert r.status_code == 409


async def test_partner_staff_cannot_reject_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    staff_headers = await _login_as_partner_staff(api, auth_headers)

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/reject",
        json={"reason": "nope"},
        headers=staff_headers,
    )
    assert r.status_code == 403


# ── release ────────────────────────────────────────────────────────────


async def test_release_from_approved_clears_channel(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    # Move orphan into approved.
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/approve",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 200

    # Set an assignment we expect release to clear.
    r = await api.post(
        "/api/v1/marketing-channels",
        json={
            "name_ar": f"قناة-{uuid.uuid4().hex[:6]}",
            "name_en": "Release channel",
            "channel_type": "digital_marketing",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    channel_id = r.json()["id"]
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/assign-channel",
        json={"channel_id": channel_id},
        headers=auth_headers,
    )
    assert r.status_code == 200

    # Release → case_status flips to available, channel cleared.
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/release",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["case_status"] == "available"

    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT assigned_to_channel_id, assignment_deadline "
                    "FROM orphans WHERE id = :id"
                ),
                {"id": orphan_id},
            )
        ).first()
        assert row is not None
        assert row[0] is None
        assert row[1] is None


async def test_release_from_pending_409(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    # Still pending_review — release is only legal from approved/reserved.
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/release",
        json={},
        headers=auth_headers,
    )
    assert r.status_code == 409


async def test_partner_staff_cannot_release_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    staff_headers = await _login_as_partner_staff(api, auth_headers)

    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/release",
        json={},
        headers=staff_headers,
    )
    assert r.status_code == 403
