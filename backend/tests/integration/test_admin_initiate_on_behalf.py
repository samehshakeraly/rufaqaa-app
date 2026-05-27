"""POST /payments/admin/initiate-on-behalf.

Admin opens a hosted-checkout on behalf of a walk-in donor. The Payment
row must record both the real donor (donor_id) and the admin who
initiated (initiated_by_user_id), and the MyFatoorah send_payment service
is stubbed so we don't touch the network.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.services import myfatoorah


@pytest.fixture
def fake_gateway(monkeypatch):
    state: dict = {"prefix": uuid.uuid4().hex[:8], "n": 0}

    async def _fake_send_payment(**kw):
        state["n"] += 1
        invoice_id = f"{state['prefix']}-{state['n']}"
        return myfatoorah.SendPaymentResult(
            invoice_id=invoice_id,
            payment_url=f"https://apitest.myfatoorah.com/checkout/{invoice_id}",
            raw={"InvoiceId": invoice_id},
        )

    monkeypatch.setattr(myfatoorah, "send_payment", _fake_send_payment)
    return state


async def _make_donor(api: AsyncClient, headers: dict[str, str]) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/donors",
        json={
            "full_name": f"Walk-in Donor {suffix}",
            "email": f"walkin-{suffix}@example.com",
            "preferred_currency": "KWD",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_admin_initiate_returns_url_and_stamps_initiator(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": donor_id, "amount": "12.50", "currency": "KWD"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invoice_id"]
    assert body["payment_url"].startswith("https://apitest")
    payment_id = body["payment_id"]

    # The row must record the admin who initiated.
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT initiated_by_user_id, donor_id, status, payment_gateway "
                    "FROM payments WHERE id = :pid"
                ),
                {"pid": payment_id},
            )
        ).first()
        assert row is not None
        initiated_by, payment_donor_id, status_, gateway = row
        assert initiated_by is not None
        assert str(payment_donor_id) == donor_id
        assert status_ == "pending"
        assert gateway == "myfatoorah"


async def test_admin_initiate_requires_admin(api: AsyncClient, fake_gateway) -> None:
    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": str(uuid.uuid4()), "amount": "1.00", "currency": "KWD"},
    )
    assert r.status_code == 401


async def test_admin_initiate_unknown_donor_404(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": str(uuid.uuid4()), "amount": "1.00", "currency": "KWD"},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_admin_initiate_sponsorship_must_match_donor(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    # Two donors, sponsorship belongs to A — try to initiate for B with A's sponsorship.
    donor_a = await _make_donor(api, auth_headers)
    donor_b = await _make_donor(api, auth_headers)

    # Need an orphan to create a sponsorship.
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        partner_id = row[0]

    suffix = uuid.uuid4().hex[:6]
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"on-behalf-{suffix}",
                "family_name": "test",
                "date_of_birth": "2015-01-01",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": "father",
            },
            headers=auth_headers,
        )
    ).json()
    sp = (
        await api.post(
            "/api/v1/sponsorships",
            json={
                "donor_id": donor_a,
                "orphan_id": orphan["id"],
                "monthly_amount": "10.00",
                "currency": "KWD",
                "start_date": "2026-06-01",
            },
            headers=auth_headers,
        )
    ).json()

    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={
            "donor_id": donor_b,
            "sponsorship_id": sp["id"],
            "amount": "10.00",
            "currency": "KWD",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "does not belong" in r.json()["detail"].lower()


async def test_admin_initiate_audited_as_sensitive(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": donor_id, "amount": "5.00", "currency": "KWD"},
        headers=auth_headers,
    )
    assert r.status_code == 201
    pid = r.json()["payment_id"]

    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT action, is_sensitive FROM audit_log "
                    "WHERE entity_type = 'payment' AND entity_id = :pid "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"pid": pid},
            )
        ).first()
        assert row is not None
        action, is_sensitive = row
        assert action == "payment.admin_initiated_on_behalf"
        assert is_sensitive is True
