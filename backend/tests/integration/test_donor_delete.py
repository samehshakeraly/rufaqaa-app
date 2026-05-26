"""Soft-delete a donor: requires admin, blocked when active sponsorships exist."""

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


async def test_delete_donor_succeeds_without_active_sponsorships(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    donor = (
        await api.post(
            "/api/v1/donors",
            json={"full_name": "محسن للحذف", "email": f"del-{suffix}@example.com"},
            headers=auth_headers,
        )
    ).json()

    r = await api.delete(f"/api/v1/donors/{donor['id']}", headers=auth_headers)
    assert r.status_code == 204

    # Now invisible via the list (deleted_at filter)
    page = await api.get("/api/v1/donors?limit=200", headers=auth_headers)
    assert all(d["id"] != donor["id"] for d in page.json()["items"])


async def test_delete_donor_blocked_by_active_sponsorship(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    donor = (
        await api.post(
            "/api/v1/donors",
            json={"full_name": "محسن مرتبط", "email": f"link-{suffix}@example.com"},
            headers=auth_headers,
        )
    ).json()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"حذف-{suffix}",
                "family_name": "محظور",
                "date_of_birth": "2014-05-05",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
            },
            headers=auth_headers,
        )
    ).json()
    sp = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor["id"],
            "orphan_id": orphan["id"],
            "monthly_amount": "10.00",
            "currency": "KWD",
            "start_date": "2026-06-01",
        },
        headers=auth_headers,
    )
    assert sp.status_code == 201

    r = await api.delete(f"/api/v1/donors/{donor['id']}", headers=auth_headers)
    assert r.status_code == 409

    # Cancel and retry
    await api.post(
        f"/api/v1/sponsorships/{sp.json()['id']}/cancel",
        json={"reason": "donor leaving"},
        headers=auth_headers,
    )
    r = await api.delete(f"/api/v1/donors/{donor['id']}", headers=auth_headers)
    assert r.status_code == 204
