"""PATCH /sponsorships, pause/resume."""

from __future__ import annotations

import uuid

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


async def _setup(api: AsyncClient, h: dict[str, str]) -> str:
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    donor = (
        await api.post(
            "/api/v1/donors",
            json={"full_name": "كافل", "email": f"life-{suffix}@example.com"},
            headers=h,
        )
    ).json()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"دورة-{suffix}",
                "family_name": "حياة",
                "date_of_birth": "2014-03-03",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
            },
            headers=h,
        )
    ).json()
    sp = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor["id"],
            "orphan_id": orphan["id"],
            "monthly_amount": "20.00",
            "currency": "KWD",
            "start_date": "2026-06-01",
        },
        headers=h,
    )
    assert sp.status_code == 201
    return sp.json()["id"]


async def test_pause_and_resume(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    sp_id = await _setup(api, auth_headers)

    r = await api.post(f"/api/v1/sponsorships/{sp_id}/pause", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "paused"

    # Pausing a paused one rejected
    r = await api.post(f"/api/v1/sponsorships/{sp_id}/pause", headers=auth_headers)
    assert r.status_code == 409

    r = await api.post(f"/api/v1/sponsorships/{sp_id}/resume", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "active"


async def test_patch_changes_amount_and_notes(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    sp_id = await _setup(api, auth_headers)
    r = await api.patch(
        f"/api/v1/sponsorships/{sp_id}",
        json={"monthly_amount": "35.50", "notes": "raised"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["monthly_amount"] == "35.50"
    assert r.json()["notes"] == "raised"


async def test_patch_blocked_after_cancel(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    sp_id = await _setup(api, auth_headers)
    await api.post(
        f"/api/v1/sponsorships/{sp_id}/cancel",
        json={"reason": "done"},
        headers=auth_headers,
    )
    r = await api.patch(
        f"/api/v1/sponsorships/{sp_id}",
        json={"notes": "too late"},
        headers=auth_headers,
    )
    assert r.status_code == 409
