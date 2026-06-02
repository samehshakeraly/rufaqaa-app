"""GET /media — the staff moderation queue.

Covers the happy path the MediaReviewPage relies on: a freshly uploaded
item shows up under ?moderation_status=pending, and once it's approved it
leaves the pending list and appears under ?moderation_status=approved.
Also guards the role gate (only approvers can see the queue).
"""

from __future__ import annotations

import socket
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session


def _s3_reachable() -> bool:
    parsed = urlparse(settings.S3_ENDPOINT)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


s3_required = pytest.mark.skipif(
    not _s3_reachable(), reason=f"S3 endpoint {settings.S3_ENDPOINT} not reachable"
)

# Tiny valid JPEG payload (the MIME check looks at the declared content
# type only — the bytes themselves don't need to be a real image).
_TINY_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


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
            "first_name": f"قائمة-{suffix}",
            "family_name": "وسائط",
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


async def _my_org_id(api: AsyncClient, h: dict[str, str]) -> str:
    me = (await api.get("/api/v1/auth/me", headers=h)).json()
    return me["organization_id"]


async def _insert_pending_media(orphan_id: str, organization_id: str) -> str:
    """Drop a pending media row straight into the table — no S3 needed.

    Mirrors the post-upload state (moderation_status='pending',
    visibility='private'). GET /media still mints a presigned URL from the
    s3:// value, which boto3 does locally without contacting the bucket.
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


def _find(items: list[dict[str, object]], media_id: str) -> dict[str, object] | None:
    return next((i for i in items if i["id"] == media_id), None)


# ── happy path: pending → approve → approved ────────────────────────────


async def test_pending_media_appears_then_moves_to_approved(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)

    # It shows up in the pending queue, with a usable presigned URL.
    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "pending", "limit": 100},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["limit"] == 100
    assert page["offset"] == 0
    assert page["total"] >= 1
    item = _find(page["items"], media_id)
    assert item is not None, "uploaded media missing from pending queue"
    assert item["orphan_id"] == orphan_id
    assert item["media_type"] == "photo"
    assert item["moderation_status"] == "pending"
    assert item["visibility"] == "private"
    assert item["file_size_bytes"] == 20
    assert str(item["file_url"]).startswith("s3://")
    assert str(item["presigned_url"]).startswith("http")

    # Approve it.
    r = await api.post(
        f"/api/v1/media/{media_id}/moderate",
        json={"decision": "approve"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    # Gone from pending …
    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "pending", "limit": 100},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert _find(r.json()["items"], media_id) is None

    # … and now in approved, with the bumped visibility.
    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "approved", "limit": 100},
        headers=auth_headers,
    )
    assert r.status_code == 200
    approved = _find(r.json()["items"], media_id)
    assert approved is not None, "approved media missing from approved queue"
    assert approved["moderation_status"] == "approved"
    assert approved["visibility"] == "donor_only"


async def test_queue_defaults_to_pending_status(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    media_id = await _insert_pending_media(orphan_id, org_id)

    # No moderation_status param → pending by default.
    r = await api.get("/api/v1/media", headers=auth_headers)
    assert r.status_code == 200, r.text
    ids = [i["id"] for i in r.json()["items"]]
    assert media_id in ids


# ── role gate: only approvers see the queue ─────────────────────────────


async def test_partner_staff_cannot_view_queue_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    staff_headers = await _login_as_partner_staff(api, auth_headers)
    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "pending"},
        headers=staff_headers,
    )
    assert r.status_code == 403


# ── validation ──────────────────────────────────────────────────────────


async def test_invalid_moderation_status_422(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "bogus"},
        headers=auth_headers,
    )
    assert r.status_code == 422


# ── end-to-end via the real upload endpoint (needs MinIO) ───────────────


@s3_required
async def test_real_upload_appears_in_pending_queue(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    files = {"file": ("queue.jpg", _TINY_JPEG, "image/jpeg")}
    r = await api.post(
        f"/api/v1/media/orphans/{orphan_id}/photo",
        files=files,
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    media_id = r.json()["id"]

    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "pending", "limit": 100},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    item = _find(r.json()["items"], media_id)
    assert item is not None
    assert item["orphan_id"] == orphan_id
    assert str(item["presigned_url"]).startswith("http")
