"""PATCH /reports/{id} only works while the report is still a draft."""

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


async def _create_orphan_then_report(api: AsyncClient, h: dict[str, str]) -> tuple[str, str]:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"محرر-{suffix}",
                "family_name": "تقرير",
                "date_of_birth": "2015-03-03",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
            },
            headers=h,
        )
    ).json()
    report = (
        await api.post(
            "/api/v1/reports",
            json={
                "orphan_id": orphan["id"],
                "report_type": "monthly",
                "period_start": "2026-05-01",
                "period_end": "2026-05-31",
            },
            headers=h,
        )
    ).json()
    return orphan["id"], report["id"]


async def test_patch_draft_updates_content(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    _orphan_id, report_id = await _create_orphan_then_report(api, auth_headers)
    r = await api.patch(
        f"/api/v1/reports/{report_id}",
        json={
            "summary": "تقدّم ممتاز هذا الشهر",
            "educational_progress": {"grade": "ممتاز", "average": 92},
            "quran_progress": {"surah": "البقرة", "from": 1, "to": 30},
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"].startswith("تقدّم")

    # GET reflects the saved content
    r = await api.get(f"/api/v1/reports/{report_id}", headers=auth_headers)
    assert r.json()["summary"].startswith("تقدّم")


async def test_patch_blocked_after_submit(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    _orphan_id, report_id = await _create_orphan_then_report(api, auth_headers)
    r = await api.post(f"/api/v1/reports/{report_id}/submit", json={}, headers=auth_headers)
    assert r.status_code == 200
    r = await api.patch(
        f"/api/v1/reports/{report_id}",
        json={"summary": "too late"},
        headers=auth_headers,
    )
    assert r.status_code == 409
