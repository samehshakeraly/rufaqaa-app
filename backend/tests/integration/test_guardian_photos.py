"""Guardian self-service photo upload + view.

A guardian may upload/list photos ONLY for orphans in their own family. Every
upload lands moderation_status='pending' / visibility='private' and flows into
the SAME staff moderation queue as staff uploads (GET /media?moderation_status=
pending, PR #68) — nothing is auto-approved.

The happy-path upload streams bytes to object storage; rather than gate it on a
live MinIO (like test_media.py / test_guardian_uploads.py do for the document
path) we stub `ensure_bucket`/`put_object`, so the full upload→queue assertion
runs deterministically everywhere. `presigned_get_url` is a local boto3 signing
call (no network), so the read endpoints work unpatched.

The 403/404/415 paths run without any storage because ownership and MIME are
checked before a byte is read.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# The endpoint checks the declared MIME only; the bytes need not be a real image.
_TINY_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
_TINY_PDF = b"%PDF-1.4\n%minimal\n"


# ── Helpers (standalone restatement, like the sibling guardian tests) ───


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_orphan_in_family(
    api: AsyncClient, admin_headers: dict[str, str], family_id: str
) -> str:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"p-{suffix}",
            "family_name": "Photo",
            "date_of_birth": "2016-03-12",
            "gender": "M",
            "nationality": "KW",
            "partner_organization_id": partner_id,
            "father_name": f"father-{suffix}",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    orphan_id = r.json()["id"]
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET family_id = :fid WHERE id = :id"),
            {"fid": family_id, "id": orphan_id},
        )
        await db.commit()
    return orphan_id


async def _create_family_and_guardian(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Provision (family, guardian-user) and return (family_id, auth_headers)."""
    me = (await api.get("/api/v1/auth/me", headers=admin_headers)).json()
    org_id = me["organization_id"]

    family_id = str(uuid.uuid4())
    family_code = f"FAM-{uuid.uuid4().hex[:6].upper()}"
    async with make_session() as db:
        await db.execute(text("SELECT set_config('app.current_org_id', :v, true)"), {"v": org_id})
        await db.execute(
            text(
                "INSERT INTO families (id, organization_id, code, family_name) "
                "VALUES (:id, :org, :code, 'photo-family')"
            ),
            {"id": family_id, "org": org_id, "code": family_code},
        )
        await db.commit()

    email = f"gp-{uuid.uuid4().hex[:8]}@example.com"
    password = "guardpw123456"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Photo",
            "last_name": "Guardian",
            "role": "guardian",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = r.json()["user"]["id"]
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    async with make_session() as db:
        await db.execute(text("SELECT set_config('app.current_org_id', :v, true)"), {"v": org_id})
        await db.execute(
            text(
                "INSERT INTO guardians (id, organization_id, family_id, user_id, "
                "full_name, relation) "
                "VALUES (gen_random_uuid(), :org, :fam, :uid, :name, 'mother')"
            ),
            {
                "org": org_id,
                "fam": family_id,
                "uid": user_id,
                "name": f"G-{uuid.uuid4().hex[:6]}",
            },
        )
        await db.commit()

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return family_id, {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _insert_media(orphan_id: str, organization_id: str, moderation_status: str) -> str:
    """Drop a media row straight into the table (no S3) with a given status."""
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
                     file_url, file_size_bytes, moderation_status, visibility, created_at)
                VALUES
                    (:id, :org, :orphan, 'photo',
                     :url, :size, :status, 'private', :now)
                """
            ),
            {
                "id": str(media_id),
                "org": organization_id,
                "orphan": orphan_id,
                "url": f"s3://test-bucket/orphans/{orphan_id}/{media_id.hex}.jpg",
                "size": 20,
                "status": moderation_status,
                "now": datetime.now(UTC),
            },
        )
        await db.commit()
    return str(media_id)


def _stub_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    """No-op the bucket/put calls so the upload runs without a live MinIO.
    The s3:// URL is still recorded, so the read path (presigned_get_url, a
    local boto3 op) keeps working."""

    async def _noop(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr("app.api.v1.guardian_self.ensure_bucket", _noop)
    monkeypatch.setattr("app.api.v1.guardian_self.put_object", _noop)


# ── Happy path: upload → pending → guardian list + moderator queue ──────


async def test_guardian_uploads_photo_lands_pending_and_in_moderator_queue(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    _stub_storage(monkeypatch)

    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_id}/photos",
        files={"file": ("photo.jpg", _TINY_JPEG, "image/jpeg")},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["moderation_status"] == "pending"
    media_id = body["id"]

    # The guardian sees their own upload (with a usable presigned URL).
    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_id}/photos", headers=headers)
    assert r.status_code == 200, r.text
    mine = next((p for p in r.json() if p["id"] == media_id), None)
    assert mine is not None, "guardian's own upload missing from their photo list"
    assert mine["moderation_status"] == "pending"
    assert str(mine["presigned_url"]).startswith("http")

    # And it surfaces in the SAME staff moderation queue as staff uploads (#68),
    # read here by the seed admin (a moderator role).
    r = await api.get(
        "/api/v1/media",
        params={"moderation_status": "pending", "limit": 100},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    queued = next((m for m in r.json()["items"] if m["id"] == media_id), None)
    assert queued is not None, "guardian upload did not reach the moderator queue"
    assert queued["orphan_id"] == orphan_id
    assert queued["visibility"] == "private"


async def test_guardian_sees_photos_of_all_statuses(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The guardian sees every photo of THEIR orphan regardless of moderation
    status (pending/approved/rejected) — scoped to their family only."""
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    org_id = (await api.get("/api/v1/auth/me", headers=auth_headers)).json()["organization_id"]

    ids = {
        status: await _insert_media(orphan_id, org_id, status)
        for status in ("pending", "approved", "rejected")
    }

    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_id}/photos", headers=headers)
    assert r.status_code == 200, r.text
    returned = {p["id"]: p["moderation_status"] for p in r.json()}
    for status, mid in ids.items():
        assert returned.get(mid) == status


# ── Ownership / validation (no storage needed) ──────────────────────────


async def test_guardian_cannot_upload_photo_for_other_family_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Ownership is enforced before any byte is read → 403 with no storage."""
    _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)

    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_b}/photos",
        files={"file": ("photo.jpg", _TINY_JPEG, "image/jpeg")},
        headers=headers_a,
    )
    assert r.status_code == 403, r.text


async def test_non_guardian_upload_photo_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin has no Guardian row → 404 (we don't leak reachability)."""
    family_id, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_id}/photos",
        files={"file": ("photo.jpg", _TINY_JPEG, "image/jpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_guardian_upload_non_image_415(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Non-image MIME is rejected (before any byte is stored)."""
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_id}/photos",
        files={"file": ("doc.pdf", _TINY_PDF, "application/pdf")},
        headers=headers,
    )
    assert r.status_code == 415, r.text


async def test_guardian_cannot_list_other_family_photos_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)

    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_b}/photos", headers=headers_a)
    assert r.status_code == 403, r.text


async def test_non_guardian_list_photos_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    family_id, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_id}/photos", headers=auth_headers)
    assert r.status_code == 404, r.text
