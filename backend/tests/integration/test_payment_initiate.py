"""POST /payments/initiate + /payments/{id}/refund.

The MyFatoorah service is monkey-patched so these tests don't make any
outbound HTTP calls.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from decimal import Decimal

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services import myfatoorah


def _sign(body: bytes) -> str:
    return hmac.new(
        (settings.MYFATOORAH_WEBHOOK_SECRET or "").encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()


def _hmac_headers(body: bytes) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.MYFATOORAH_WEBHOOK_SECRET:
        headers["X-MyFatoorah-Signature"] = _sign(body)
    return headers


@pytest.fixture
def fake_gateway(monkeypatch):
    """Stub out the MyFatoorah HTTP calls so initiate / refund run
    end-to-end against the real DB without touching the network. Uses
    a per-test uuid prefix so repeated runs don't collide on
    gateway_transaction_id."""
    state: dict = {
        "prefix": uuid.uuid4().hex[:8],
        "invoice_counter": 0,
        "refund_counter": 0,
    }

    async def _fake_send_payment(**kw):
        state["invoice_counter"] += 1
        invoice_id = f"{state['prefix']}-{state['invoice_counter']}"
        return myfatoorah.SendPaymentResult(
            invoice_id=invoice_id,
            payment_url=f"https://apitest.myfatoorah.com/checkout/{invoice_id}",
            raw={"InvoiceId": invoice_id},
        )

    async def _fake_make_refund(**kw):
        state["refund_counter"] += 1
        ref = f"RF-{state['prefix']}-{state['refund_counter']}"
        return myfatoorah.RefundResult(
            refund_id=ref,
            raw={"RefundReference": ref},
        )

    monkeypatch.setattr(myfatoorah, "send_payment", _fake_send_payment)
    monkeypatch.setattr(myfatoorah, "make_refund", _fake_make_refund)
    return state


async def _make_donor(api: AsyncClient, headers: dict[str, str]) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/donors",
        json={
            "full_name": f"Init Donor {suffix}",
            "email": f"init-{suffix}@example.com",
            "preferred_currency": "KWD",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_initiate_returns_payment_url(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": donor_id,
            "amount": "25.00",
            "currency": "KWD",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invoice_id"]
    assert body["payment_url"].startswith("https://apitest")
    assert body["payment_id"]


async def test_initiate_creates_pending_payment_row(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "10.00", "currency": "KWD"},
        headers=auth_headers,
    )
    payment_id = r.json()["payment_id"]
    # The row is queryable via the regular list endpoint
    r = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    row = next(p for p in r.json()["items"] if p["id"] == payment_id)
    assert row["status"] == "pending"
    assert row["payment_gateway"] == "myfatoorah"
    assert row["amount"] == "10.00"


async def test_initiate_unknown_donor_404(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    r = await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": str(uuid.uuid4()),
            "amount": "1.00",
            "currency": "KWD",
        },
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_initiate_gateway_failure_502(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch
) -> None:
    async def _explode(**kw):
        raise myfatoorah.MyFatoorahError("simulated", status_code=500)

    monkeypatch.setattr(myfatoorah, "send_payment", _explode)
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "5.00", "currency": "KWD"},
        headers=auth_headers,
    )
    assert r.status_code == 502
    assert "simulated" in r.json()["detail"]


async def test_webhook_flips_initiated_row_to_completed(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    # 1. initiate
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "15.00", "currency": "KWD"},
        headers=auth_headers,
    )
    payment_id = r.json()["payment_id"]
    invoice_id = r.json()["invoice_id"]

    # 2. gateway calls our webhook with success
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "15.00",
                "Currency": "KWD",
                "CustomerEmail": (
                    await api.get("/api/v1/donors?limit=100", headers=auth_headers)
                ).json()["items"][0]["email"],
            }
        }
    ).encode("utf-8")
    # Use the donor we just made (CustomerEmail lookup falls back to donor by email)
    r2 = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    donor_email_row = next(p for p in r2.json()["items"] if p["id"] == payment_id)
    _ = donor_email_row

    # Re-build the body with the correct donor email
    r3 = await api.get("/api/v1/donors?limit=100", headers=auth_headers)
    donor_email = next(d["email"] for d in r3.json()["items"] if d["id"] == donor_id)
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "15.00",
                "Currency": "KWD",
                "CustomerEmail": donor_email,
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200, r.text

    # 3. our row is now completed (same id, not a new row)
    r = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    rows = [p for p in r.json()["items"] if p["id"] == payment_id]
    assert len(rows) == 1
    assert rows[0]["status"] == "completed"
    assert rows[0]["completed_at"] is not None


async def test_refund_marks_completed_payment_refunded(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    # Initiate + complete via webhook to get a refundable row
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "30.00", "currency": "KWD"},
        headers=auth_headers,
    )
    payment_id = r.json()["payment_id"]
    invoice_id = r.json()["invoice_id"]
    donor_email = next(
        d["email"]
        for d in (await api.get("/api/v1/donors?limit=100", headers=auth_headers)).json()["items"]
        if d["id"] == donor_id
    )
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "30.00",
                "Currency": "KWD",
                "CustomerEmail": donor_email,
            }
        }
    ).encode("utf-8")
    await api.post("/api/v1/webhooks/myfatoorah", content=body, headers=_hmac_headers(body))

    # Full refund
    r = await api.post(
        f"/api/v1/payments/{payment_id}/refund",
        json={"amount": "30.00", "reason": "customer cancelled"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded"


async def test_refund_pending_payment_409(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "20.00", "currency": "KWD"},
        headers=auth_headers,
    )
    payment_id = r.json()["payment_id"]

    r = await api.post(
        f"/api/v1/payments/{payment_id}/refund",
        json={"amount": "20.00", "reason": "too soon"},
        headers=auth_headers,
    )
    assert r.status_code == 409


async def test_refund_partial_marks_partially_refunded(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "40.00", "currency": "KWD"},
        headers=auth_headers,
    )
    payment_id = r.json()["payment_id"]
    invoice_id = r.json()["invoice_id"]
    donor_email = next(
        d["email"]
        for d in (await api.get("/api/v1/donors?limit=100", headers=auth_headers)).json()["items"]
        if d["id"] == donor_id
    )
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "40.00",
                "Currency": "KWD",
                "CustomerEmail": donor_email,
            }
        }
    ).encode("utf-8")
    await api.post("/api/v1/webhooks/myfatoorah", content=body, headers=_hmac_headers(body))

    r = await api.post(
        f"/api/v1/payments/{payment_id}/refund",
        json={"amount": "15.00", "reason": "partial credit"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "partially_refunded"


async def test_refund_amount_over_payment_400(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "10.00", "currency": "KWD"},
        headers=auth_headers,
    )
    payment_id = r.json()["payment_id"]
    invoice_id = r.json()["invoice_id"]
    donor_email = next(
        d["email"]
        for d in (await api.get("/api/v1/donors?limit=100", headers=auth_headers)).json()["items"]
        if d["id"] == donor_id
    )
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "10.00",
                "Currency": "KWD",
                "CustomerEmail": donor_email,
            }
        }
    ).encode("utf-8")
    await api.post("/api/v1/webhooks/myfatoorah", content=body, headers=_hmac_headers(body))
    r = await api.post(
        f"/api/v1/payments/{payment_id}/refund",
        json={"amount": "20.00", "reason": "overshoot"},
        headers=auth_headers,
    )
    assert r.status_code == 400


_ = Decimal  # silence ruff
