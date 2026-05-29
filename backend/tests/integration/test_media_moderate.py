"""POST /media/{id}/moderate — human moderation of uploaded media."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
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
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"مود-{suffix}",
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


async def _insert_pending_media(orphan_id: str, organization_id: str) -> str:
    """Drop a pending media row straight into the table — no S3 needed.

    The moderate endpoint only reads/writes the moderation columns, so
    we don't need a real uploaded object behind the row.
    """
    media_id = uuid.uuid4()
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": organization_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO media
                    (id, organization_id, orphan_id, media_type,
                     file_url, file_size_bytes, moderation_status,
                     visibility, created_at)
                VALUES
                    (:id, :org, :orphan, 'photo',
                     :url, :size, 'pending',
                     'private', :now)
                """
            ),
            {
                "id": str(media_id),
                "org": organization_id,
                "orphan": orphan_id,
                "url": f"s3://test-bucket/orphans/{orphan_id}/{media_id.hex}.jpg",
                "size": 20,
                "now": datetime.now(UTC),
            },
        )
        await db.commit()
    return str(media_id)


async def _my_org_id(api: AsyncClient, h: dict[str, str]) -> str:
    me = (await api.get("/api/v1/auth/me", headers=h)).json()
    return me["organization_id"]


async def _login_as_partner_staff(api: AsyncClient, auth_headers: dict[str, str]) -> dict[str, str]:
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


# ── happy paths ────────────────────────────────────────────────────────


async def test_approve_pending_media_sets_visibility_donor_only(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)

    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json={"decision": "approve", "notes": "looks fine"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["moderation_status"] == "approved"
    assert body["visibility"] == "donor_only"
    assert body["moderation_notes"] == "looks fine"
    assert body["moderated_by"] is not None
    assert body["moderated_at"] is not None


async def test_reject_pending_media_keeps_visibility_private(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)

    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json={"decision": "reject", "notes": "blurry"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["moderation_status"] == "rejected"
    assert body["visibility"] == "private"


# ── illegal transition ─────────────────────────────────────────────────


async def test_double_moderate_409(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)

    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json={"decision": "approve"},
        headers=auth_headers,
    )
    assert r.status_code == 200

    # Second decision on the same row is illegal.
    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json={"decision": "reject"},
        headers=auth_headers,
    )
    assert r.status_code == 409


async def test_moderate_missing_media_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.post(
        f"/api/v1/media/{uuid.uuid4()}/moderate",
        json={"decision": "approve"},
        headers=auth_headers,
    )
    assert r.status_code == 404


# ── forbidden role ─────────────────────────────────────────────────────


async def test_partner_staff_cannot_moderate_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)
    staff_headers = await _login_as_partner_staff(api, auth_headers)

    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json={"decision": "approve"},
        headers=staff_headers,
    )
    assert r.status_code == 403


# ── invalid payload ────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["yes", "delete", "", None])
async def test_invalid_decision_422(
    api: AsyncClient, auth_headers: dict[str, str], bad: str | None
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)

    payload: dict[str, object] = {"decision": bad} if bad is not None else {}
    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json=payload,
        headers=auth_headers,
    )
    assert r.status_code == 422
