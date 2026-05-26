"""Per-orphan timeline aggregates sponsorships, payments, reports."""

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


async def test_timeline_includes_sponsorship_payment_report(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    donor = (
        await api.post(
            "/api/v1/donors",
            json={"full_name": "كافل سلسلة", "email": f"tl-{suffix}@example.com"},
            headers=auth_headers,
        )
    ).json()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"سلسلة-{suffix}",
                "family_name": "حياة",
                "date_of_birth": "2014-06-06",
                "gender": "F",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
            },
            headers=auth_headers,
        )
    ).json()
    sp = (
        await api.post(
            "/api/v1/sponsorships",
            json={
                "donor_id": donor["id"],
                "orphan_id": orphan["id"],
                "monthly_amount": "15.00",
                "currency": "KWD",
                "start_date": "2026-06-01",
            },
            headers=auth_headers,
        )
    ).json()
    await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor["id"],
            "sponsorship_id": sp["id"],
            "amount": "15.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": orphan["id"],
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        },
        headers=auth_headers,
    )

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/timeline", headers=auth_headers)
    assert r.status_code == 200, r.text
    kinds = {it["kind"] for it in r.json()["items"]}
    assert {"sponsorship", "payment", "report"} <= kinds


async def test_timeline_404_for_unknown_orphan(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(f"/api/v1/orphans/{uuid.uuid4()}/timeline", headers=auth_headers)
    assert r.status_code == 404
