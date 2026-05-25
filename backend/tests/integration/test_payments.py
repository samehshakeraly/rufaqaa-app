import uuid
from decimal import Decimal

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


async def _make_donor(api: AsyncClient, h: dict[str, str], email: str) -> str:
    r = await api.post("/api/v1/donors", json={"full_name": "كافل", "email": email}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يتيم-{unique}",
            "family_name": "دفع",
            "date_of_birth": "2017-08-10",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{unique}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _make_sponsorship(
    api: AsyncClient, h: dict[str, str], donor_id: str, orphan_id: str
) -> dict:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "currency": "KWD",
            "start_date": "2026-06-01",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_manual_payment_updates_sponsorship_totals(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    email = f"pay-{uuid.uuid4().hex[:8]}@example.com"
    donor_id = await _make_donor(api, auth_headers, email)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)

    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "sponsorship_id": sp["id"],
            "amount": "20.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["code"].startswith("PAY-")
    assert body["status"] == "completed"

    sp_after = (await api.get(f"/api/v1/sponsorships/{sp['id']}", headers=auth_headers)).json()
    assert Decimal(sp_after["total_paid"]) == Decimal("20.00")
    assert sp_after["payments_count"] == 1

    page = await api.get(f"/api/v1/payments?sponsorship_id={sp['id']}", headers=auth_headers)
    assert page.status_code == 200
    assert page.json()["total"] == 1


async def _webhook_headers() -> dict[str, str]:
    """Provide the signature header configured in settings (if any)."""
    from app.core.config import settings

    if settings.MYFATOORAH_WEBHOOK_SECRET:
        return {"X-MyFatoorah-Signature": settings.MYFATOORAH_WEBHOOK_SECRET}
    return {}


async def test_myfatoorah_webhook_records_completed_payment(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    email = f"wh-{uuid.uuid4().hex[:8]}@example.com"
    donor_id = await _make_donor(api, auth_headers, email)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)

    txn_id = f"txn-{uuid.uuid4().hex[:10]}"
    payload = {
        "Data": {
            "InvoiceId": txn_id,
            "InvoiceStatus": "Paid",
            "InvoiceValue": "20.00",
            "Currency": "KWD",
            "CustomerEmail": email,
            "CustomerReference": sp["code"],
        }
    }
    headers = await _webhook_headers()

    r = await api.post("/api/v1/webhooks/myfatoorah", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["payment_status"] == "completed"

    r2 = await api.post("/api/v1/webhooks/myfatoorah", json=payload, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "duplicate"

    sp_after = (await api.get(f"/api/v1/sponsorships/{sp['id']}", headers=auth_headers)).json()
    assert Decimal(sp_after["total_paid"]) == Decimal("20.00")
    assert sp_after["payments_count"] == 1


async def test_myfatoorah_webhook_rejects_unknown_donor(api: AsyncClient) -> None:
    payload = {
        "Data": {
            "InvoiceId": f"txn-{uuid.uuid4().hex[:10]}",
            "InvoiceStatus": "Paid",
            "InvoiceValue": "10.00",
            "Currency": "KWD",
            "CustomerEmail": "nobody-here@example.com",
        }
    }
    headers = await _webhook_headers()
    r = await api.post("/api/v1/webhooks/myfatoorah", json=payload, headers=headers)
    assert r.status_code == 404


async def test_myfatoorah_webhook_rejects_bad_signature(api: AsyncClient) -> None:
    from app.core.config import settings

    if not settings.MYFATOORAH_WEBHOOK_SECRET:
        import pytest

        pytest.skip("webhook secret not configured")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        json={"Data": {"InvoiceId": "x", "InvoiceStatus": "Paid"}},
        headers={"X-MyFatoorah-Signature": "wrong"},
    )
    assert r.status_code == 401
