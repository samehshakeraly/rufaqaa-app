"""Documents CRUD scoped per orphan."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


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


async def test_invalid_document_type_422(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        f"/api/v1/orphans/{orphan_id}/documents",
        json={"document_type": "not_a_type", "file_url": "s3://x.pdf"},
        headers=auth_headers,
    )
    assert r.status_code == 422
