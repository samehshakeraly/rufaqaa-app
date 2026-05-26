"""Admin payment status override + audit."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


async def _make_payment(api: AsyncClient, h: dict[str, str]) -> str:
    donor = (
        await api.post(
            "/api/v1/donors",
            json={"full_name": "محسن", "email": f"ps-{uuid.uuid4().hex[:6]}@example.com"},
            headers=h,
        )
    ).json()
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor["id"],
            "amount": "5.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=h,
    )
    assert r.status_code == 201
    return r.json()["id"]


async def test_status_override_records_audit(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    pid = await _make_payment(api, auth_headers)
    r = await api.post(
        f"/api/v1/payments/{pid}/status",
        json={"status": "refunded", "reason": "duplicate charge"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded"

    audit = await api.get(
        f"/api/v1/audit?entity_type=payment&entity_id={pid}&limit=5",
        headers=auth_headers,
    )
    assert audit.status_code == 200
    actions = [e["action"] for e in audit.json()["items"]]
    assert "payment.status_changed" in actions


async def test_status_noop_does_not_audit(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    pid = await _make_payment(api, auth_headers)
    # Already 'completed' from create_payment
    audit_before = (
        await api.get(f"/api/v1/audit?entity_type=payment&entity_id={pid}", headers=auth_headers)
    ).json()["total"]
    r = await api.post(
        f"/api/v1/payments/{pid}/status",
        json={"status": "completed"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    audit_after = (
        await api.get(f"/api/v1/audit?entity_type=payment&entity_id={pid}", headers=auth_headers)
    ).json()["total"]
    assert audit_after == audit_before
