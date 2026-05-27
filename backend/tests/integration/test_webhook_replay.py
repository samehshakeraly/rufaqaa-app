"""Inbound webhook log + replay endpoint."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid

from httpx import AsyncClient

from app.core.config import settings


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


async def test_failed_delivery_is_logged_then_replayable(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # 1. Send a payload that won't match any donor → 404 + logged
    txn_id = f"replay-{uuid.uuid4().hex[:8]}"
    body = json.dumps(
        {
            "Data": {
                "InvoiceId": txn_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "25.00",
                "CustomerEmail": "doesnotexist@example.com",
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 404, r.text

    # 2. The log has the failed delivery
    r = await api.get(
        "/api/v1/webhooks/log?source=myfatoorah&only_failed=true&limit=20",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    failed = [
        x for x in r.json()["items"] if x["payload"].get("Data", {}).get("InvoiceId") == txn_id
    ]
    assert len(failed) == 1
    log_id = failed[0]["id"]
    assert failed[0]["response_status"] == 404
    assert failed[0]["replayed_from"] is None

    # 3. Replay the failed entry — still 404 (donor still missing for
    # the original payload's email) but a new log row is written.
    r = await api.post(f"/api/v1/webhooks/log/{log_id}/replay", headers=auth_headers)
    assert r.status_code == 404

    # 4. The replay was logged with replayed_from set
    r = await api.get(
        "/api/v1/webhooks/log?source=myfatoorah&only_failed=true&limit=50",
        headers=auth_headers,
    )
    assert r.status_code == 200
    replays = [x for x in r.json()["items"] if x["replayed_from"] == log_id]
    assert len(replays) >= 1


async def test_replay_unknown_log_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.post(f"/api/v1/webhooks/log/{uuid.uuid4()}/replay", headers=auth_headers)
    assert r.status_code == 404


async def test_log_requires_admin(api: AsyncClient) -> None:
    r = await api.get("/api/v1/webhooks/log")
    assert r.status_code == 401
