"""POST /bank-transfers/{id}/confirm-receipt with optional document_id.

Verifies the confirm-receipt endpoint persists the attached
confirmation_document_id, appends a timestamped note, and 404s when
referencing a non-existent document.
"""

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


async def _create_orphan_document(api: AsyncClient, headers: dict[str, str]) -> str:
    """Create an orphan + a document attached to it; return doc id."""
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"doc-host-{suffix}",
                "family_name": "test",
                "date_of_birth": "2015-01-01",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": "father",
            },
            headers=headers,
        )
    ).json()
    r = await api.post(
        f"/api/v1/orphans/{orphan['id']}/documents",
        json={
            "document_type": "other",
            "title": "Bank receipt proof",
            "file_url": "https://storage.example.com/receipts/proof.pdf",
            "file_name": "proof.pdf",
            "file_mime_type": "application/pdf",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_completed_transfer(
    api: AsyncClient, headers: dict[str, str], partner_id: str
) -> str:
    r = await api.post(
        "/api/v1/bank-transfers",
        json={
            "partner_organization_id": partner_id,
            "amount": "100.00",
            "currency": "KWD",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
            "notes": "Original notes",
        },
        headers=headers,
    )
    tid = r.json()["id"]
    await api.post(f"/api/v1/bank-transfers/{tid}/approve", headers=headers)
    await api.post(f"/api/v1/bank-transfers/{tid}/mark-completed", headers=headers)
    return tid


async def test_confirm_receipt_with_document_attaches_it(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    tid = await _create_completed_transfer(api, auth_headers, partner_id)
    doc_id = await _create_orphan_document(api, auth_headers)

    r = await api.post(
        f"/api/v1/bank-transfers/{tid}/confirm-receipt",
        json={"confirmation_document_id": doc_id, "notes": "Got it"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["confirmed_by_partner_at"] is not None
    assert body["confirmation_document_id"] == doc_id
    assert "Got it" in (body["notes"] or "")
    assert "confirm-receipt" in (body["notes"] or "")


async def test_confirm_receipt_without_payload_works(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    tid = await _create_completed_transfer(api, auth_headers, partner_id)
    r = await api.post(
        f"/api/v1/bank-transfers/{tid}/confirm-receipt",
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["confirmed_by_partner_at"] is not None
    assert r.json()["confirmation_document_id"] is None


async def test_confirm_receipt_unknown_document_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    tid = await _create_completed_transfer(api, auth_headers, partner_id)
    r = await api.post(
        f"/api/v1/bank-transfers/{tid}/confirm-receipt",
        json={"confirmation_document_id": str(uuid.uuid4())},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_confirm_receipt_blocked_unless_completed(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    r = await api.post(
        "/api/v1/bank-transfers",
        json={
            "partner_organization_id": partner_id,
            "amount": "1.00",
            "currency": "KWD",
            "period_start": "2026-01-01",
            "period_end": "2026-01-31",
        },
        headers=auth_headers,
    )
    tid = r.json()["id"]
    # Still pending — can't confirm yet.
    r = await api.post(
        f"/api/v1/bank-transfers/{tid}/confirm-receipt",
        headers=auth_headers,
    )
    assert r.status_code == 409
