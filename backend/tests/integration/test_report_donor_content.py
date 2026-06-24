"""Donor-facing report content + per-section visibility (PR 2A).

Three things are exercised here:

* the donor projection (``ReportDonorRead`` from ``/me/reports``) applies
  ``section_visibility`` — hidden sections collapse to ``null``, the visibility
  map itself NEVER reaches the donor, and ``donor_message`` / milestone fields
  ride along;
* the full staff view (``ReportDetailRead`` from ``GET /reports/{id}``) returns
  every section's content plus the visibility map;
* migration 0022 is reversible (upgrade ↔ downgrade) against the test DB.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session
from app.schemas.report import SECTION_KEYS

_BACKEND_DIR = Path(__file__).resolve().parents[2]

# Canonical section content reused across the visibility tests.
_EDUCATION = {
    "stage": "ابتدائي",
    "school_name": "مدرسة النور",
    "overall_rating": "excellent",
    "attendance_percent": 96,
    "subjects": [{"name": "الرياضيات", "grade": "ممتاز"}],
    "note": "تقدّم ملحوظ هذا الفصل.",
}
_QURAN = {
    "juz_memorized": 3,
    "current_juz": 4,
    "evaluation": "very_good",
    "recent": "سورة يس",
    "note": "مواظبة جيدة على الحلقة.",
}
_ACTIVITIES = {"items": [{"title": "كرة القدم", "note": None}], "note": "مشاركة فعّالة"}
_HEALTH = {"general": "good", "note": "لا مشكلات صحية."}
_PSYCH = {"mood": "good", "social": "good", "note": "اندماج جيد مع الأقران."}


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _publish_report(
    api: AsyncClient, headers: dict[str, str], report_extra: dict[str, Any]
) -> tuple[str, str]:
    """Create donor + orphan + active sponsorship + a report carrying
    ``report_extra``, then walk it to ``published_to_donor``.

    Returns ``(donor_id, report_id)``.
    """
    suffix = uuid.uuid4().hex[:6]
    partner_id = await _seed_partner_id()
    donor = (
        await api.post(
            "/api/v1/donors",
            json={
                "full_name": f"Sponsor {suffix}",
                "email": f"sponsor-{suffix}@example.com",
                "preferred_currency": "KWD",
            },
            headers=headers,
        )
    ).json()
    orphan = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"orph-{suffix}",
                "family_name": "test",
                "date_of_birth": "2014-01-01",
                "gender": "M",
                "partner_organization_id": partner_id,
                "father_name": "father",
            },
            headers=headers,
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
        headers=headers,
    )
    assert sp.status_code == 201, sp.text
    await api.post(f"/api/v1/sponsorships/{sp.json()['id']}/activate", headers=headers)

    base = {
        "orphan_id": orphan["id"],
        "report_type": "monthly",
        "period_start": "2026-04-01",
        "period_end": "2026-04-30",
        "summary": "ملخّص التقرير الشهري",
    }
    r = await api.post("/api/v1/reports", json={**base, **report_extra}, headers=headers)
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    for step in ("submit", "approve-partner", "approve-org", "publish"):
        rr = await api.post(f"/api/v1/reports/{rid}/{step}", headers=headers)
        assert rr.status_code == 200, (step, rr.text)
    return donor["id"], rid


async def _donor_item(api: AsyncClient, headers: dict[str, str], donor_id: str, rid: str) -> dict:
    page = (await api.get(f"/api/v1/me/reports?donor_id={donor_id}", headers=headers)).json()
    item = next((it for it in page["items"] if it["id"] == rid), None)
    assert item is not None, page
    return item


async def test_hidden_section_omitted_visibility_never_leaks(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A section hidden via section_visibility is dropped from the donor view,
    while the visible sections, donor_message and milestone fields all show —
    and section_visibility itself never appears in the donor payload."""
    donor_id, rid = await _publish_report(
        api,
        auth_headers,
        {
            "educational_progress": _EDUCATION,
            "quran_progress": _QURAN,
            "psychological_status": _PSYCH,
            "section_visibility": {"psychological": False},
            "donor_message": "نشكر لكم كفالتكم الكريمة ودعمكم المتواصل.",
            "is_milestone": True,
            "milestone_label": "أتمّ حفظ جزء جديد",
        },
    )
    item = await _donor_item(api, auth_headers, donor_id, rid)

    # Visible sections survive, with their canonical codes intact.
    assert item["educational_progress"] is not None
    assert item["educational_progress"]["overall_rating"] == "excellent"
    assert item["educational_progress"]["attendance_percent"] == 96
    assert item["quran_progress"] is not None
    assert item["quran_progress"]["juz_memorized"] == 3
    assert item["quran_progress"]["evaluation"] == "very_good"

    # The hidden section is gone (null), even though it was stored.
    assert item["psychological_status"] is None

    # Donor-facing extras ride along.
    assert item["donor_message"] == "نشكر لكم كفالتكم الكريمة ودعمكم المتواصل."
    assert item["is_milestone"] is True
    assert item["milestone_label"] == "أتمّ حفظ جزء جديد"

    # The visibility map must NEVER reach the donor.
    assert "section_visibility" not in item


async def test_empty_visibility_shows_all_sections(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The product default — no section_visibility sent ⇒ every provided
    section is visible to the donor."""
    donor_id, rid = await _publish_report(
        api,
        auth_headers,
        {
            "educational_progress": _EDUCATION,
            "quran_progress": _QURAN,
            "activities": _ACTIVITIES,
            "health_status": _HEALTH,
            "psychological_status": _PSYCH,
        },
    )
    item = await _donor_item(api, auth_headers, donor_id, rid)

    assert item["educational_progress"] is not None
    assert item["quran_progress"] is not None
    assert item["activities"] is not None
    assert item["health_status"] is not None
    assert item["psychological_status"] is not None
    assert "section_visibility" not in item


async def test_all_sections_can_be_hidden(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A supervisor can hide every section; the donor then sees only the
    summary / donor_message / milestone, with all section bodies null."""
    donor_id, rid = await _publish_report(
        api,
        auth_headers,
        {
            "educational_progress": _EDUCATION,
            "quran_progress": _QURAN,
            "activities": _ACTIVITIES,
            "health_status": _HEALTH,
            "psychological_status": _PSYCH,
            "section_visibility": {key: False for key in SECTION_KEYS},
            "donor_message": "تحياتنا وتقديرنا لكفالتكم.",
        },
    )
    item = await _donor_item(api, auth_headers, donor_id, rid)

    for field in (
        "educational_progress",
        "quran_progress",
        "activities",
        "health_status",
        "psychological_status",
    ):
        assert item[field] is None, field
    assert item["summary"] == "ملخّص التقرير الشهري"
    assert item["donor_message"] == "تحياتنا وتقديرنا لكفالتكم."
    assert "section_visibility" not in item


async def test_staff_detail_view_returns_full_content(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """GET /reports/{id} (ReportDetailRead) returns every section's content —
    including one hidden from donors — plus the visibility map itself."""
    _donor_id, rid = await _publish_report(
        api,
        auth_headers,
        {
            "educational_progress": _EDUCATION,
            "quran_progress": _QURAN,
            "psychological_status": _PSYCH,
            "section_visibility": {"psychological": False},
            "is_milestone": True,
            "milestone_label": "الأول على صفّه هذا الفصل",
        },
    )
    detail = (await api.get(f"/api/v1/reports/{rid}", headers=auth_headers)).json()

    assert detail["educational_progress"]["overall_rating"] == "excellent"
    assert detail["educational_progress"]["subjects"][0]["name"] == "الرياضيات"
    assert detail["quran_progress"]["evaluation"] == "very_good"
    # The section hidden from donors is fully visible to staff.
    assert detail["psychological_status"]["mood"] == "good"
    # Staff see the visibility map and milestone fields.
    assert detail["section_visibility"] == {"psychological": False}
    assert detail["is_milestone"] is True
    assert detail["milestone_label"] == "الأول على صفّه هذا الفصل"


async def _column_exists(column: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'orphan_reports' AND column_name = :c"
                ),
                {"c": column},
            )
        ).first()
    return row is not None


async def test_migration_0022_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """`alembic downgrade 0021` drops the four new columns; `upgrade 0022`
    brings them back. Always restored to head in `finally` so the shared test
    DB is left untouched for the rest of the suite."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    new_columns = ("section_visibility", "donor_message", "is_milestone", "milestone_label")

    try:
        command.downgrade(cfg, "0021")
        for column in new_columns:
            assert not await _column_exists(column), f"{column} should be gone after downgrade"

        command.upgrade(cfg, "0022")
        for column in new_columns:
            assert await _column_exists(column), f"{column} should return after upgrade"
    finally:
        command.upgrade(cfg, "head")

    _ = api, auth_headers
