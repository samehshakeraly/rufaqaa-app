"""GET /orphanage/me + /orphanage/me/orphans + /orphanage/me/reports.

Mirrors test_guardian_self.py: an orphanage_manager must only ever see THEIR
own dar and the orphans resident in it, must get a 404 when they manage no
dar, and must never reach another dar's residents or reports.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.models.report import OrphanReport

# ── Helpers ────────────────────────────────────────────────────────────


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _invite_manager(
    api: AsyncClient,
    admin_headers: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """Invite + accept an orphanage_manager user. Returns (user_id, headers).

    Uses the real invite/accept/login flow (no auth bypass) so we get a
    verified, active user holding role='orphanage_manager'.
    """
    email = f"m-{uuid.uuid4().hex[:8]}@example.com"
    password = "managerpw12345"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "Dar",
            "last_name": "Manager",
            "role": "orphanage_manager",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = r.json()["user"]["id"]

    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return user_id, headers


async def _make_orphanage(
    api: AsyncClient,
    admin_headers: dict[str, str],
    *,
    manager_user_id: str | None = None,
) -> str:
    """Create a dar via the org-scoped staff endpoint. Returns its id."""
    suffix = uuid.uuid4().hex[:6]
    body: dict[str, str] = {"name_ar": f"دار-{suffix}", "name_en": f"Dar {suffix}"}
    if manager_user_id is not None:
        body["manager_user_id"] = manager_user_id
    r = await api.post("/api/v1/orphanages", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_manager_and_orphanage(
    api: AsyncClient,
    admin_headers: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """Provision a manager + a dar they run. Returns (orphanage_id, headers)."""
    user_id, headers = await _invite_manager(api, admin_headers)
    orphanage_id = await _make_orphanage(api, admin_headers, manager_user_id=user_id)
    return orphanage_id, headers


async def _make_resident_orphan(
    api: AsyncClient,
    admin_headers: dict[str, str],
    orphanage_id: str | None,
    *,
    nickname: str = "y",
) -> str:
    """Create an orphan; when orphanage_id is given the orphan is a resident
    of that dar, otherwise it stays a family-home orphan. Returns the id."""
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    body: dict[str, object] = {
        "first_name": f"{nickname}-{suffix}",
        "family_name": "مقيم",
        "date_of_birth": "2015-04-01",
        "gender": "M",
        "nationality": "KW",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
    }
    if orphanage_id is not None:
        body["orphanage_id"] = orphanage_id
    r = await api.post("/api/v1/orphans", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── /orphanage/me ──────────────────────────────────────────────────────


async def test_manager_can_fetch_own_orphanage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphanage_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    r = await api.get("/api/v1/orphanage/me", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == orphanage_id
    assert body["code"].startswith("DAR-")
    assert body["name_ar"]


async def test_non_manager_user_gets_404_on_me(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin manages no dar — the endpoint must not confirm that
    /orphanage/me is reachable for non-managers."""
    r = await api.get("/api/v1/orphanage/me", headers=auth_headers)
    assert r.status_code == 404


async def test_manager_with_no_orphanage_gets_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A real orphanage_manager who hasn't been assigned a dar yet → 404
    (the resource is the gate)."""
    _, headers = await _invite_manager(api, auth_headers)
    r = await api.get("/api/v1/orphanage/me", headers=headers)
    assert r.status_code == 404


# ── /orphanage/me/orphans ──────────────────────────────────────────────


async def test_manager_lists_only_own_residents(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    dar_a, headers_a = await _create_manager_and_orphanage(api, auth_headers)
    dar_b, headers_b = await _create_manager_and_orphanage(api, auth_headers)

    resident_a = await _make_resident_orphan(api, auth_headers, dar_a, nickname="a")
    resident_b = await _make_resident_orphan(api, auth_headers, dar_b, nickname="b")

    r = await api.get("/api/v1/orphanage/me/orphans", headers=headers_a)
    assert r.status_code == 200
    ids_a = {o["id"] for o in r.json()}
    assert resident_a in ids_a
    assert resident_b not in ids_a  # isolation

    # Manager B is isolated symmetrically.
    r = await api.get("/api/v1/orphanage/me/orphans", headers=headers_b)
    ids_b = {o["id"] for o in r.json()}
    assert resident_b in ids_b
    assert resident_a not in ids_b


async def test_manager_residents_omit_financials(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    await _make_resident_orphan(api, auth_headers, dar_id)

    r = await api.get("/api/v1/orphanage/me/orphans", headers=headers)
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    for item in items:
        for forbidden in ("current_balance", "is_sponsored", "balance_currency"):
            assert forbidden not in item, f"{forbidden} leaked to the manager"


async def test_family_home_orphan_is_not_a_resident(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An orphan with orphanage_id = NULL is a family-home case and must never
    appear in a manager's resident list."""
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id, nickname="res")
    family_home = await _make_resident_orphan(api, auth_headers, None, nickname="home")

    r = await api.get("/api/v1/orphanage/me/orphans", headers=headers)
    assert r.status_code == 200
    ids = {o["id"] for o in r.json()}
    assert resident in ids
    assert family_home not in ids


async def test_non_manager_cannot_list_residents(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin manages no dar → 404 (resource is the gate)."""
    r = await api.get("/api/v1/orphanage/me/orphans", headers=auth_headers)
    assert r.status_code == 404


# ── /orphanage/me/reports (list) ───────────────────────────────────────


async def test_manager_can_list_resident_reports(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id)

    # Drop a draft report straight in (admin acts on behalf).
    r = await api.post(
        "/api/v1/reports",
        json={
            "orphan_id": resident,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    r = await api.get(
        f"/api/v1/orphanage/me/reports?orphan_id={resident}",
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert any(item["id"] == rid for item in r.json())


async def test_manager_cannot_list_reports_for_another_orphanage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    dar_a, headers_a = await _create_manager_and_orphanage(api, auth_headers)
    dar_b, _ = await _create_manager_and_orphanage(api, auth_headers)
    resident_b = await _make_resident_orphan(api, auth_headers, dar_b)

    r = await api.get(
        f"/api/v1/orphanage/me/reports?orphan_id={resident_b}",
        headers=headers_a,
    )
    assert r.status_code == 403


# ── /orphanage/me/reports (create) ─────────────────────────────────────


async def test_manager_submits_report_for_resident(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Happy path: the manager submits a report for a resident; it lands in
    pending_partner_approval and surfaces in their own reports list."""
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id)

    r = await api.post(
        "/api/v1/orphanage/me/reports",
        json={
            "orphan_id": resident,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
            "summary": "شهر هادئ ومثمر",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["status"] == "pending_partner_approval"
    assert created["submitted_at"] is not None
    assert created["orphan_id"] == resident

    # It surfaces in the manager's own reports list.
    r = await api.get(f"/api/v1/orphanage/me/reports?orphan_id={resident}", headers=headers)
    assert r.status_code == 200
    assert any(item["id"] == created["id"] for item in r.json())


async def test_manager_submits_rich_report_persists_all_fields(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A structured submission — typed sections, per-section visibility (one
    section hidden), a note to the sponsor, and a milestone flag — must land on
    the orphan_reports row exactly as sent (the ReportRead response is meta-only,
    so we read the row back to assert the JSONB + scalar columns)."""
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id)

    body: dict[str, object] = {
        "orphan_id": resident,
        "report_type": "quarterly",
        "period_start": "2026-04-01",
        "period_end": "2026-06-30",
        "summary": "ربع هادئ ومثمر",
        "educational_progress": {
            "stage": "الصف الرابع",
            "school_name": "مدرسة النور",
            "overall_rating": "very_good",
            "attendance_percent": 95,
            "subjects": [
                {"name": "الرياضيات", "grade": "A"},
                {"name": "العربية"},
            ],
            "note": "تحسّن ملحوظ",
        },
        "quran_progress": {
            "juz_memorized": 5,
            "current_juz": 6,
            "evaluation": "good",
            "recent": "سورة الكهف",
            "note": "مواظب",
        },
        "activities": {
            "items": [{"title": "كرة القدم", "note": "كل سبت"}],
            "note": "نشيط اجتماعياً",
        },
        "health_status": {"general": "good", "note": "لا شكاوى"},
        "psychological_status": {"mood": "good", "social": "improving", "note": "أكثر انفتاحاً"},
        "donor_message": "ابنكم بخير ويشكر دعمكم",
        "is_milestone": True,
        "milestone_label": "أتمّ الجزء الخامس",
        # Only the hidden section is sent; the rest stay visible by default.
        "section_visibility": {"health": False},
    }
    r = await api.post("/api/v1/orphanage/me/reports", json=body, headers=headers)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["status"] == "pending_partner_approval"
    assert created["submitted_at"] is not None
    assert created["report_type"] == "quarterly"

    # Read the row straight back via the ORM (JSONB columns deserialise to dicts).
    async with make_session() as db:
        report = await db.get(OrphanReport, uuid.UUID(created["id"]))
        assert report is not None

        assert report.educational_progress is not None
        assert report.educational_progress["overall_rating"] == "very_good"
        assert report.educational_progress["attendance_percent"] == 95
        # The grade-less subject round-trips with grade=None (model_dump keeps it).
        assert report.educational_progress["subjects"] == [
            {"name": "الرياضيات", "grade": "A"},
            {"name": "العربية", "grade": None},
        ]

        assert report.quran_progress is not None
        assert report.quran_progress["juz_memorized"] == 5
        assert report.quran_progress["current_juz"] == 6
        assert report.quran_progress["evaluation"] == "good"

        assert report.activities is not None
        assert report.activities["items"] == [{"title": "كرة القدم", "note": "كل سبت"}]

        assert report.health_status is not None
        assert report.health_status["general"] == "good"

        assert report.psychological_status is not None
        assert report.psychological_status["mood"] == "good"
        assert report.psychological_status["social"] == "improving"

        assert report.donor_message == "ابنكم بخير ويشكر دعمكم"
        assert report.is_milestone is True
        assert report.milestone_label == "أتمّ الجزء الخامس"
        # Hidden-only map persists verbatim ("visible unless explicitly false").
        assert report.section_visibility == {"health": False}


async def test_manager_report_defaults_visibility_to_empty_map(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """When the manager sends no section_visibility, the column defaults to an
    empty map ⇒ every section is visible (the product default)."""
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id)

    r = await api.post(
        "/api/v1/orphanage/me/reports",
        json={
            "orphan_id": resident,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
            "summary": "بلا أقسام",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    async with make_session() as db:
        report = await db.get(OrphanReport, uuid.UUID(r.json()["id"]))
        assert report is not None
        assert report.section_visibility == {}
        assert report.is_milestone is False
        assert report.educational_progress is None


async def test_manager_submit_report_rejects_bad_period(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """period_end before period_start → 400 (mirrors the guardian validation)."""
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id)

    r = await api.post(
        "/api/v1/orphanage/me/reports",
        json={
            "orphan_id": resident,
            "report_type": "monthly",
            "period_start": "2026-05-31",
            "period_end": "2026-05-01",
        },
        headers=headers,
    )
    assert r.status_code == 400, r.text


async def test_manager_cannot_submit_report_for_another_orphanage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A manager cannot report on a resident of a different dar → 403."""
    dar_a, headers_a = await _create_manager_and_orphanage(api, auth_headers)
    dar_b, _ = await _create_manager_and_orphanage(api, auth_headers)
    resident_b = await _make_resident_orphan(api, auth_headers, dar_b)

    r = await api.post(
        "/api/v1/orphanage/me/reports",
        json={
            "orphan_id": resident_b,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        },
        headers=headers_a,
    )
    assert r.status_code == 403, r.text


async def test_manager_cannot_submit_report_for_family_home_orphan(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A family-home orphan (orphanage_id = NULL) is never a resident → 403."""
    dar_id, headers = await _create_manager_and_orphanage(api, auth_headers)
    family_home = await _make_resident_orphan(api, auth_headers, None)

    r = await api.post(
        "/api/v1/orphanage/me/reports",
        json={
            "orphan_id": family_home,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        },
        headers=headers,
    )
    assert r.status_code == 403, r.text


async def test_non_manager_cannot_submit_report(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The seed admin manages no dar → 404 (resource is the gate)."""
    dar_id, _ = await _create_manager_and_orphanage(api, auth_headers)
    resident = await _make_resident_orphan(api, auth_headers, dar_id)

    r = await api.post(
        "/api/v1/orphanage/me/reports",
        json={
            "orphan_id": resident,
            "report_type": "monthly",
            "period_start": "2026-05-01",
            "period_end": "2026-05-31",
        },
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text
