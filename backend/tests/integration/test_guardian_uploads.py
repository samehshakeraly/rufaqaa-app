"""Guardian self-service uploads: report submission + document upload (G-04/G-03).

Ownership + role enforcement is the heart of these tests:
  * a guardian may create reports / upload documents ONLY for orphans in
    their own family (cross-family → 403),
  * a caller without a Guardian row (e.g. the seed admin) → 404 (we don't
    confirm the endpoint is reachable to non-guardians),
  * everything a guardian sends lands in a PENDING state and surfaces in the
    EXISTING staff review workflow — nothing is auto-published.

The document-upload happy path needs object storage, so it is guarded by
`s3_required` (skips when MinIO isn't reachable), exactly like test_media.py.
The 403/404 paths run without storage because ownership is checked before any
byte is read.
"""

from __future__ import annotations

import socket
import uuid
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

# The endpoint checks the declared MIME only; the bytes need not be a real PDF.
_TINY_PDF = b"%PDF-1.4\n%minimal\n"

_REPORT_BODY = {
    "report_type": "monthly",
    "period_start": "2026-05-01",
    "period_end": "2026-05-31",
    "summary": "تقرير شهري",
    "psychological_status": {"mood": "good", "note": ""},
    "educational_progress": {"rating": 5, "note": "ممتاز"},
}


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
            "first_name": f"u-{suffix}",
            "family_name": "Test",
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
                "VALUES (:id, :org, :code, 'upload-family')"
            ),
            {"id": family_id, "org": org_id, "code": family_code},
        )
        await db.commit()

    email = f"g-{uuid.uuid4().hex[:8]}@example.com"
    password = "guardpw123456"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Up",
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


async def _attach_doc_as_admin(
    api: AsyncClient, admin_headers: dict[str, str], orphan_id: str
) -> str:
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/documents",
        json={
            "document_type": "school_certificate",
            "file_url": "s3://rufaqaa-private/orphans/seed/cert.pdf",
            "title": "seed",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── Report submission (G-04) ────────────────────────────────────────────


async def test_guardian_report_lands_pending_and_surfaces_in_review_queue(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)

    r = await api.post(
        "/api/v1/guardian/me/reports",
        json={"orphan_id": orphan_id, **_REPORT_BODY},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending_partner_approval"
    assert body["submitted_at"] is not None
    assert body["orphan_id"] == orphan_id
    rid = body["id"]

    # Reuse, don't fork: it shows up in the staff PartnerReportsReview queue
    # (GET /reports?status=pending_partner_approval), unchanged.
    r = await api.get(
        "/api/v1/reports?status=pending_partner_approval&limit=100",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert any(item["id"] == rid for item in r.json()["items"])


async def test_guardian_cannot_create_report_for_other_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)

    r = await api.post(
        "/api/v1/guardian/me/reports",
        json={"orphan_id": orphan_b, **_REPORT_BODY},
        headers=headers_a,
    )
    assert r.status_code == 403, r.text


async def test_non_guardian_create_report_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin has no Guardian row — the endpoint must 404, not leak."""
    family_id, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.post(
        "/api/v1/guardian/me/reports",
        json={"orphan_id": orphan_id, **_REPORT_BODY},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


# ── Document list (G-03) ────────────────────────────────────────────────


async def test_guardian_lists_own_orphan_documents(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    doc_id = await _attach_doc_as_admin(api, auth_headers, orphan_id)

    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_id}/documents", headers=headers)
    assert r.status_code == 200, r.text
    assert any(d["id"] == doc_id for d in r.json())


async def test_guardian_cannot_list_other_family_documents(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)

    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_b}/documents", headers=headers_a)
    assert r.status_code == 403, r.text


async def test_non_guardian_list_documents_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_id}/documents", headers=auth_headers)
    assert r.status_code == 404, r.text


# ── Document upload (G-03 "تحديث المستندات") ─────────────────────────────


async def test_guardian_upload_document_for_other_family_403_without_storage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Ownership is enforced before any byte is read, so this 403s even with
    no object-storage backend involved."""
    _, headers_a = await _create_family_and_guardian(api, auth_headers)
    family_b, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_b = await _make_orphan_in_family(api, auth_headers, family_b)

    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_b}/documents",
        files={"file": ("cert.pdf", _TINY_PDF, "application/pdf")},
        data={"document_type": "school_certificate"},
        headers=headers_a,
    )
    assert r.status_code == 403, r.text


async def test_non_guardian_upload_document_404_without_storage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, _ = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_id}/documents",
        files={"file": ("cert.pdf", _TINY_PDF, "application/pdf")},
        data={"document_type": "school_certificate"},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_guardian_upload_invalid_document_type_422(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)
    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_id}/documents",
        files={"file": ("cert.pdf", _TINY_PDF, "application/pdf")},
        data={"document_type": "not_a_type"},
        headers=headers,
    )
    assert r.status_code == 422, r.text


@s3_required
async def test_guardian_uploads_document_lands_pending(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    family_id, headers = await _create_family_and_guardian(api, auth_headers)
    orphan_id = await _make_orphan_in_family(api, auth_headers, family_id)

    r = await api.post(
        f"/api/v1/guardian/me/orphans/{orphan_id}/documents",
        files={"file": ("cert.pdf", _TINY_PDF, "application/pdf")},
        data={"document_type": "school_certificate", "title": "Term 1"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["verification_status"] == "pending"
    assert body["document_type"] == "school_certificate"
    assert body["orphan_id"] == orphan_id

    # And it surfaces in the guardian's own document list.
    r = await api.get(f"/api/v1/guardian/me/orphans/{orphan_id}/documents", headers=headers)
    assert r.status_code == 200
    assert any(d["id"] == body["id"] for d in r.json())
