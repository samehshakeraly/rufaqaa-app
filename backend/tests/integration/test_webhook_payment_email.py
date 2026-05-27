"""Webhook → payment_succeeded email dispatch.

A successful MyFatoorah `Paid` webhook delivery must trigger a templated
receipt email to the donor. We monkeypatch `send_templated` and assert
it was invoked with the expected template + variables.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services import email as email_service
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


@pytest.fixture
def capture_emails(monkeypatch):
    calls: list[dict] = []

    def _fake_send_templated(*, to: str, template: str, locale: str = "ar", **vars):
        calls.append({"to": to, "template": template, "locale": locale, **vars})
        return True

    # send_templated lives in app.services.email and is imported lazily
    # inside the webhook handler — patch the module-level name.
    monkeypatch.setattr(email_service, "send_templated", _fake_send_templated)
    return calls


async def test_paid_webhook_dispatches_payment_succeeded_email(
    api: AsyncClient,
    auth_headers: dict[str, str],
    fake_gateway,
    capture_emails,
) -> None:
    suffix = uuid.uuid4().hex[:6]
    donor = (
        await api.post(
            "/api/v1/donors",
            json={
                "full_name": f"Email Donor {suffix}",
                "email": f"email-{suffix}@example.com",
                "preferred_currency": "KWD",
            },
            headers=auth_headers,
        )
    ).json()

    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor["id"], "amount": "75.00", "currency": "KWD"},
        headers=auth_headers,
    )
    invoice_id = r.json()["invoice_id"]
    payment_code = None
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "75.00",
                "Currency": "KWD",
                "CustomerEmail": donor["email"],
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200, r.text

    matches = [c for c in capture_emails if c["template"] == "payment_succeeded"]
    assert matches, f"no payment_succeeded email captured (got: {capture_emails})"
    email = matches[-1]
    assert email["to"] == donor["email"]
    assert email["amount"] == "75.00"
    assert email["currency"] == "KWD"
    assert "payment_code" in email
    _ = payment_code


async def test_failed_webhook_does_not_dispatch_email(
    api: AsyncClient,
    auth_headers: dict[str, str],
    fake_gateway,
    capture_emails,
) -> None:
    suffix = uuid.uuid4().hex[:6]
    donor = (
        await api.post(
            "/api/v1/donors",
            json={
                "full_name": f"Email Donor {suffix}",
                "email": f"email-fail-{suffix}@example.com",
                "preferred_currency": "KWD",
            },
            headers=auth_headers,
        )
    ).json()
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor["id"], "amount": "10.00", "currency": "KWD"},
        headers=auth_headers,
    )
    invoice_id = r.json()["invoice_id"]
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Failed",
                "InvoiceValue": "10.00",
                "Currency": "KWD",
                "CustomerEmail": donor["email"],
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200
    assert not [c for c in capture_emails if c["template"] == "payment_succeeded"]
