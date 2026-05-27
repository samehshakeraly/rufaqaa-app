"""MyFatoorah refund webhook events.

The same /webhooks/myfatoorah endpoint also handles refund-status
deliveries. We test:
  - a `Refunded` event on a completed payment flips it to `refunded`
  - a `PartiallyRefunded` event flips to `partially_refunded`
  - a refund event referencing an unknown invoice yields 404
  - a duplicate refund delivery is reported as `duplicate`
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid

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
    state: dict = {"prefix": uuid.uuid4().hex[:8], "n": 0}

    async def _fake_send_payment(**kw):
        state["n"] += 1
        invoice_id = f"{state['prefix']}-{state['n']}"
        return myfatoorah.SendPaymentResult(
            invoice_id=invoice_id,
            payment_url=f"https://x/{invoice_id}",
            raw={"InvoiceId": invoice_id},
        )

    monkeypatch.setattr(myfatoorah, "send_payment", _fake_send_payment)
    return state


async def _complete_payment(api: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    """Initiate + complete a payment via the webhook so we have a
    refundable row. Returns (payment_id, invoice_id)."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/donors",
        json={
            "full_name": f"Refund Donor {suffix}",
            "email": f"refund-{suffix}@example.com",
            "preferred_currency": "KWD",
        },
        headers=headers,
    )
    donor_id = r.json()["id"]
    donor_email = r.json()["email"]

    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "50.00", "currency": "KWD"},
        headers=headers,
    )
    payment_id = r.json()["payment_id"]
    invoice_id = r.json()["invoice_id"]

    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "50.00",
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
    return payment_id, invoice_id


async def test_refund_webhook_flips_payment_to_refunded(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    payment_id, invoice_id = await _complete_payment(api, auth_headers)
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "RefundStatus": "Refunded",
                "RefundReference": f"RF-{invoice_id}",
                "RefundAmount": "50.00",
                "RefundReason": "customer cancellation",
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["event"] == "refund"
    assert out["payment_status"] == "refunded"
    assert out["payment_id"] == payment_id

    # The payment row is queryable in refunded state.
    r = await api.get(f"/api/v1/payments/{payment_id}/receipt", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "refunded"


async def test_refund_webhook_partial(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    payment_id, invoice_id = await _complete_payment(api, auth_headers)
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "RefundStatus": "PartiallyRefunded",
                "RefundReference": f"RF-{invoice_id}-part",
                "RefundAmount": "10.00",
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200
    assert r.json()["payment_status"] == "partially_refunded"
    _ = payment_id


async def test_refund_webhook_unknown_invoice_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": f"ghost-{uuid.uuid4().hex[:8]}",
                "RefundStatus": "Refunded",
                "RefundReference": "RF-ghost",
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 404
    _ = auth_headers


async def test_refund_webhook_duplicate_delivery_is_idempotent(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    payment_id, invoice_id = await _complete_payment(api, auth_headers)
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "RefundStatus": "Refunded",
                "RefundReference": f"RF-{invoice_id}",
                "RefundAmount": "50.00",
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200
    assert r.json()["payment_status"] == "refunded"

    # Same delivery again — must not flip status / not error.
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["status"] == "duplicate"
    assert out["payment_status"] == "refunded"
    assert out["payment_id"] == payment_id
    _ = auth_headers
