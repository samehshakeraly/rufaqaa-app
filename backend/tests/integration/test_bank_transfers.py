"""Bank transfer lifecycle: create → approve → mark-completed → confirm-receipt."""

from __future__ import annotations

import uuid

from httpx import AsyncClient


async def _get_partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    r = await api.get("/api/v1/partners", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["items"][0]["id"]


async def test_bank_transfer_full_lifecycle(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _get_partner_id(api, auth_headers)

    # 1. Create
    r = await api.post(
        "/api/v1/bank-transfers",
        json={
            "partner_organization_id": partner_id,
            "amount": "500.00",
            "currency": "KWD",
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
            "bank_name": "NBK",
            "notes": "April distribution",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["code"].startswith("TRF-")
    tid = body["id"]

    # 2. Approve
    r = await api.post(f"/api/v1/bank-transfers/{tid}/approve", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "approved"
    assert r.json()["approved_at"] is not None

    # 3. Re-approving rejected (409)
    r = await api.post(f"/api/v1/bank-transfers/{tid}/approve", headers=auth_headers)
    assert r.status_code == 409

    # 4. Mark completed
    r = await api.post(f"/api/v1/bank-transfers/{tid}/mark-completed", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "completed"
    assert r.json()["executed_at"] is not None

    # 5. Partner confirms receipt
    r = await api.post(f"/api/v1/bank-transfers/{tid}/confirm-receipt", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["confirmed_by_partner_at"] is not None

    # 6. List filters
    r = await api.get(
        f"/api/v1/bank-transfers?status=completed&partner_id={partner_id}",
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert any(t["id"] == tid for t in r.json()["items"])


async def test_bank_transfer_period_validation(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _get_partner_id(api, auth_headers)
    r = await api.post(
        "/api/v1/bank-transfers",
        json={
            "partner_organization_id": partner_id,
            "amount": "10.00",
            "currency": "KWD",
            "period_start": "2026-05-30",
            "period_end": "2026-05-01",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400


async def test_bank_transfer_unknown_partner_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.post(
        "/api/v1/bank-transfers",
        json={
            "partner_organization_id": str(uuid.uuid4()),
            "amount": "10.00",
            "currency": "KWD",
            "period_start": "2026-01-01",
            "period_end": "2026-01-31",
        },
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_cancel_from_pending(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _get_partner_id(api, auth_headers)
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
    r = await api.post(f"/api/v1/bank-transfers/{tid}/cancel", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    # Cannot approve a cancelled transfer
    r = await api.post(f"/api/v1/bank-transfers/{tid}/approve", headers=auth_headers)
    assert r.status_code == 409
