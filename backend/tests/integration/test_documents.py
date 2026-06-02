"""Documents CRUD scoped per orphan."""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User


async def _make_orphan(api: AsyncClient, headers: dict[str, str]) -> str:
    r = await api.get("/api/v1/partners", headers=headers)
    partner_id = r.json()["items"][0]["id"]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"Doc{uuid.uuid4().hex[:4]}",
            "family_name": "Test",
            "date_of_birth": "2017-06-15",
            "gender": "F",
            "nationality": "KW",
            "father_name": "Test Father",
            "partner_organization_id": partner_id,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_document_attach_list_verify_delete(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    # 1. attach
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/documents",
        json={
            "document_type": "birth_certificate",
            "file_url": "s3://rufaqaa-private/orphans/abc/birth.pdf",
            "file_name": "birth.pdf",
            "file_size_bytes": 102400,
            "file_mime_type": "application/pdf",
            "issuing_authority": "Ministry of Interior",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["document_type"] == "birth_certificate"
    assert doc["verification_status"] == "pending"
    doc_id = doc["id"]

    # 2. list
    r = await api.get(f"/api/v1/orphans/{orphan_id}/documents", headers=auth_headers)
    assert r.status_code == 200
    assert any(d["id"] == doc_id for d in r.json()["items"])

    # 3. verify
    r = await api.post(
        f"/api/v1/documents/{doc_id}/verify",
        json={"status": "verified", "notes": "Cross-checked with national database"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["verification_status"] == "verified"
    assert r.json()["verified_at"] is not None

    # 4. delete
    r = await api.delete(f"/api/v1/documents/{doc_id}", headers=auth_headers)
    assert r.status_code == 204

    # gone from the list
    r = await api.get(f"/api/v1/orphans/{orphan_id}/documents", headers=auth_headers)
    assert all(d["id"] != doc_id for d in r.json()["items"])


async def test_attach_to_unknown_orphan_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.post(
        f"/api/v1/orphans/{uuid.uuid4()}/documents",
        json={
            "document_type": "other",
            "file_url": "s3://x/y.pdf",
        },
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_guardian_documents_attach_and_list(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A guardian record can carry its own documents (e.g. national ID,
    custody papers). The attach/list endpoints mirror the orphan path."""
    # Create family + guardian
    r = await api.post(
        "/api/v1/families",
        json={"family_name": f"Smith-{uuid.uuid4().hex[:4]}"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    family_id = r.json()["id"]
    r = await api.post(
        f"/api/v1/families/{family_id}/guardians",
        json={
            "full_name": "Test Guardian",
            "relation": "mother",
            "phone": "+96599000000",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    guardian_id = r.json()["id"]

    r = await api.post(
        f"/api/v1/guardians/{guardian_id}/documents",
        json={
            "document_type": "national_id",
            "file_url": "s3://rufaqaa-private/guardians/x/id.pdf",
            "file_name": "id.pdf",
            "file_mime_type": "application/pdf",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["document_type"] == "national_id"

    r = await api.get(f"/api/v1/guardians/{guardian_id}/documents", headers=auth_headers)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 1


async def test_guardian_documents_unknown_guardian_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.post(
        f"/api/v1/guardians/{uuid.uuid4()}/documents",
        json={"document_type": "other", "file_url": "s3://x.pdf"},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_invalid_document_type_422(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/documents",
        json={"document_type": "not_a_type", "file_url": "s3://x.pdf"},
        headers=auth_headers,
    )
    assert r.status_code == 422


# ── GET /documents/{id}/url — presigned view link for reviewers ──────────


async def test_document_url_returns_presigned_for_org_member(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A staff member of the document's org gets a short-lived URL for the
    stored file. boto3 signs the s3:// value locally (no live bucket needed),
    so the link comes back as a browser-reachable http(s) URL."""
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/documents",
        json={
            "document_type": "birth_certificate",
            "file_url": "s3://rufaqaa-private/orphans/abc/birth.pdf",
            "file_name": "birth.pdf",
            "file_mime_type": "application/pdf",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]

    r = await api.get(f"/api/v1/documents/{doc_id}/url", headers=auth_headers)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("http")
    assert "birth.pdf" in url


async def test_document_url_missing_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get(f"/api/v1/documents/{uuid.uuid4()}/url", headers=auth_headers)
    assert r.status_code == 404


async def test_document_url_is_org_scoped(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A document is only viewable inside its own organization. A staff user
    from another org gets a 404 — never a link to someone else's file."""
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/documents",
        json={"document_type": "other", "file_url": "s3://rufaqaa-private/x/secret.pdf"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    doc_id = r.json()["id"]

    # A fresh admin in a different organization.
    suffix = uuid.uuid4().hex[:8]
    email = f"oth-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OTD-{suffix[:6].upper()}",
            name_ar="منظمة أخرى",
            name_en="Other Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
        db.add(
            User(
                organization_id=org.id,
                email=email,
                password_hash=hash_password(password),
                first_name="Other",
                last_name="Admin",
                role="org_admin",
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    other = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = await api.get(f"/api/v1/documents/{doc_id}/url", headers=other)
    assert r.status_code == 404, r.text
