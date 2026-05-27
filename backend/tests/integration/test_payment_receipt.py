"""GET /payments/{id}/receipt — bundle for the print-friendly receipt page."""

from __future__ import annotations

import uuid
from decimal import Decimal

from httpx import AsyncClient


async def _make_donor_and_payment(api: AsyncClient, headers: dict[str, str]) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/donors",
        json={
            "full_name": f"Test Donor {suffix}",
            "email": f"donor-{suffix}@example.com",
            "preferred_currency": "KWD",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    donor_id = r.json()["id"]

    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "amount": "25.00",
            "currency": "KWD",
            "payment_method": "knet",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_receipt_returns_bundle(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    pid = await _make_donor_and_payment(api, auth_headers)
    r = await api.get(f"/api/v1/payments/{pid}/receipt", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["payment_id"] == pid
    assert Decimal(body["amount"]) == Decimal("25.00")
    assert body["currency"] == "KWD"
    assert body["donor_name"].startswith("Test Donor ")
    assert body["organization_name_ar"]
    # No orphan / sponsorship attached
    assert body["orphan_id"] is None
    assert body["sponsorship_id"] is None


async def test_receipt_unknown_404(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get(f"/api/v1/payments/{uuid.uuid4()}/receipt", headers=auth_headers)
    assert r.status_code == 404
