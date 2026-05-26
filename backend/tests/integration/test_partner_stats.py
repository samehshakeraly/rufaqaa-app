"""Per-partner rollup at GET /partners/{id}/stats."""

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


async def test_partner_stats_returns_all_keys(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    r = await api.get(f"/api/v1/partners/{partner_id}/stats", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in (
        "partner_id",
        "orphans_total",
        "orphans_sponsored",
        "orphans_available",
        "sponsorships_active",
        "sponsorships_overdue",
        "payments_last_30d_total",
        "payments_last_30d_count",
    ):
        assert key in body
    assert body["partner_id"] == partner_id
    assert int(body["orphans_total"]) >= 0


async def test_partner_stats_404_for_unknown(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(f"/api/v1/partners/{uuid.uuid4()}/stats", headers=auth_headers)
    assert r.status_code == 404
