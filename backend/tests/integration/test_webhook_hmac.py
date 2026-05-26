"""Webhook signature accepts both HMAC-SHA256 and the raw secret."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid

from httpx import AsyncClient

from app.core.config import settings


def _sign(body: bytes) -> str:
    return hmac.new(
        settings.MYFATOORAH_WEBHOOK_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()


async def test_hmac_signature_accepted(api: AsyncClient) -> None:
    if not settings.MYFATOORAH_WEBHOOK_SECRET:
        import pytest

        pytest.skip("MYFATOORAH_WEBHOOK_SECRET not set")

    body = {
        "Data": {
            "InvoiceId": f"txn-hmac-{uuid.uuid4().hex[:8]}",
            "InvoiceStatus": "Paid",
            "InvoiceValue": "10.00",
            "Currency": "KWD",
            "CustomerEmail": "nobody-hmac@example.com",
        }
    }
    raw = json.dumps(body).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-MyFatoorah-Signature": _sign(raw),
        },
    )
    # 404 (unknown donor) is the expected post-auth response — the
    # important thing is we DIDN'T get 401.
    assert r.status_code != 401, r.text
    assert r.status_code in (404,)


async def test_wrong_hmac_rejected(api: AsyncClient) -> None:
    if not settings.MYFATOORAH_WEBHOOK_SECRET:
        import pytest

        pytest.skip("MYFATOORAH_WEBHOOK_SECRET not set")

    body = {"Data": {"InvoiceId": "x"}}
    raw = json.dumps(body).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-MyFatoorah-Signature": "0" * 64,
        },
    )
    assert r.status_code == 401
