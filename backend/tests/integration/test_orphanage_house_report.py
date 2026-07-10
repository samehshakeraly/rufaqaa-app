"""The per-dar "house report" (GET /orphanages/{orphanage_id}/report).

Counts-only aggregate over ONE dar's residents: occupancy against capacity
(including the exactly-full / over-capacity / capacity-not-recorded edges),
health + education breakdowns with the explicit "unspecified" bucket,
sponsorship coverage, file-completion aggregates (threshold boundary at 80),
and the current reporting window (non-draft reports whose period_end falls
inside the last REPORT_WINDOW_DAYS — no "late" figure, that needs a
scheduling model).

Isolation mirrors test_orphan_segments_report.py + test_orphanages.py: the
dar's own manager reads ONLY their house (any other dar → 404, same shape as
an unknown id), org A never reads org B's dar, and partner-scoped users only
reach dars of their own جهة.

The session-scoped DB accumulates rows from the whole suite, so every test
creates its own dar and asserts against that dar's residents only — the
report is naturally scoped to one orphanage_id.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select, text

from app.api.v1.orphanages import FILE_INCOMPLETE_THRESHOLD, REPORT_WINDOW_DAYS
from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.report import OrphanReport
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL

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


async def _seed_org_id() -> UUID:
    """The DEV org that ``auth_headers`` belongs to."""
    async with make_session() as db:
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert admin is not None
        return admin.organization_id


async def _make_org() -> UUID:
    """A separate (foreign) organization for cross-org isolation tests."""
    suffix = uuid4().hex[:6]
    async with make_session() as db:
        org = Organization(
            code=f"HRP-{suffix}",
            name_ar=f"منظمة-{suffix}",
            name_en=f"Org {suffix}",
            org_type="standalone",
            country_code="KW",
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)
        return org.id


async def _make_partner_org(org_id: UUID) -> str:
    """Create a جهة (partner org) in ``org_id`` and return its id."""
    suffix = uuid4().hex[:6]
    async with make_session() as db:
        partner = PartnerOrganization(
            organization_id=org_id,
            code=f"HRJ-{suffix}",
            name_ar=f"جهة-{suffix}",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        await db.refresh(partner)
        return str(partner.id)


async def _login_user(
    api: AsyncClient, org_id: UUID, partner_org_id: str | None, role: str = "partner_manager"
) -> dict[str, str]:
    """Create an active ``role`` user in ``org_id`` scoped to ``partner_org_id``
    (or NULL) and return its auth headers."""
    suffix = uuid4().hex[:8]
    email = f"{role}-{suffix}@dev.example.com"
    password = "housereportpw123456"
    async with make_session() as db:
        db.add(
            User(
                organization_id=org_id,
                partner_organization_id=UUID(partner_org_id) if partner_org_id else None,
                email=email,
                password_hash=hash_password(password),
                first_name="Test",
                last_name=role,
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _make_manager(api: AsyncClient, org_id: UUID) -> tuple[str, dict[str, str]]:
    """An active orphanage_manager user in ``org_id``. Returns (id, headers)."""
    suffix = uuid4().hex[:8]
    email = f"hr-mgr-{suffix}@dev.example.com"
    password = "housereportpw123456"
    async with make_session() as db:
        user = User(
            organization_id=org_id,
            email=email,
            password_hash=hash_password(password),
            first_name="Dar",
            last_name="Manager",
            role="orphanage_manager",
            status="active",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = str(user.id)
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return user_id, {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _make_dar(
    api: AsyncClient,
    headers: dict[str, str],
    **extra: object,
) -> dict[str, Any]:
    """Create a dar via the staff endpoint; return the full JSON body."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={"name_ar": f"دار-{suffix}", "name_en": f"Dar {suffix}", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    return body


async def _make_resident(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    orphanage_id: str | None,
    **fields: object,
) -> str:
    """Create an orphan; a non-null ``orphanage_id`` makes it a resident of
    that dar, None leaves it a family placement. Returns its id."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "first_name": f"مقيم-{suffix}",
        "family_name": "اختبار",
        "date_of_birth": "2014-01-01",
        "gender": "M",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
        **fields,
    }
    if orphanage_id is not None:
        payload["orphanage_id"] = orphanage_id
    r = await api.post("/api/v1/orphans", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _set_orphan(orphan_id: str, **updates: object) -> None:
    """Write columns the API computes or gates (profile_completion_percentage,
    case_status, deleted_at) straight to the row — the report only reads them."""
    async with make_session() as db:
        orphan = await db.get(Orphan, UUID(orphan_id))
        assert orphan is not None
        for field, value in updates.items():
            setattr(orphan, field, value)
        await db.commit()


async def _add_report(orphan_id: str, *, status: str, period_end: date) -> None:
    """Attach an OrphanReport with the given status/period_end to an orphan."""
    async with make_session() as db:
        orphan = await db.get(Orphan, UUID(orphan_id))
        assert orphan is not None
        db.add(
            OrphanReport(
                organization_id=orphan.organization_id,
                orphan_id=orphan.id,
                report_type="monthly",
                period_start=period_end - timedelta(days=30),
                period_end=period_end,
                status=status,
            )
        )
        await db.commit()


async def _report(api: AsyncClient, headers: dict[str, str], orphanage_id: str) -> dict[str, Any]:
    r = await api.get(f"/api/v1/orphanages/{orphanage_id}/report", headers=headers)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def _bucket_counts(buckets: list[dict[str, Any]]) -> dict[str, int]:
    return {b["key"]: b["count"] for b in buckets}


# ── Occupancy ────────────────────────────────────────────────────────────


async def test_occupancy_partial(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers, capacity=10)
    for _ in range(5):
        await _make_resident(api, auth_headers, partner_id, dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    assert body["orphanage_id"] == dar["id"]
    assert body["occupancy"] == {
        "capacity": 10,
        "residents": 5,
        "occupancy_pct": 50,
        "free": 5,
        "over": False,
    }


async def test_occupancy_exactly_full(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """residents == capacity is full, not over: 100%, zero free, over=False."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers, capacity=3)
    for _ in range(3):
        await _make_resident(api, auth_headers, partner_id, dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    assert body["occupancy"] == {
        "capacity": 3,
        "residents": 3,
        "occupancy_pct": 100,
        "free": 0,
        "over": False,
    }


async def test_occupancy_over_capacity(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """residents > capacity: percentage above 100, negative free, over=True."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers, capacity=2)
    for _ in range(3):
        await _make_resident(api, auth_headers, partner_id, dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    assert body["occupancy"] == {
        "capacity": 2,
        "residents": 3,
        "occupancy_pct": 150,
        "free": -1,
        "over": True,
    }


async def test_occupancy_capacity_not_recorded(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """capacity IS NULL: no percentage, no free figure, never 'over'."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)  # capacity omitted → NULL
    await _make_resident(api, auth_headers, partner_id, dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    assert body["occupancy"] == {
        "capacity": None,
        "residents": 1,
        "occupancy_pct": None,
        "free": None,
        "over": False,
    }


async def test_occupancy_capacity_zero(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """capacity == 0 (a dar with no beds): the percentage has no denominator
    (null), free goes negative and any resident counts as over."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers, capacity=0)
    await _make_resident(api, auth_headers, partner_id, dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    assert body["occupancy"] == {
        "capacity": 0,
        "residents": 1,
        "occupancy_pct": None,
        "free": -1,
        "over": True,
    }


async def test_empty_dar_report(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A dar with no residents: zero counts, null averages/percentages, empty
    breakdowns — never a division error."""
    dar = await _make_dar(api, auth_headers, capacity=4)

    body = await _report(api, auth_headers, dar["id"])
    assert body["occupancy"] == {
        "capacity": 4,
        "residents": 0,
        "occupancy_pct": 0,
        "free": 4,
        "over": False,
    }
    assert body["health"] == []
    assert body["education"] == []
    assert body["sponsorship"] == {"sponsored": 0, "unsponsored": 0, "sponsored_pct": None}
    assert body["files"] == {"avg_completion": None, "incomplete_count": 0}
    assert body["reports_window"] == {
        "window_days": REPORT_WINDOW_DAYS,
        "reported": 0,
        "not_reported": 0,
    }


# ── Health / education breakdowns ────────────────────────────────────────


async def test_health_breakdown_with_unspecified(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """NULL health_status lands in an explicit 'unspecified' bucket; buckets
    are ordered by count descending with a stable tiebreak on key."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)
    for _ in range(2):
        await _make_resident(api, auth_headers, partner_id, dar["id"], health_status="good")
    await _make_resident(api, auth_headers, partner_id, dar["id"], health_status="disability")
    await _make_resident(api, auth_headers, partner_id, dar["id"])  # health NULL

    body = await _report(api, auth_headers, dar["id"])
    assert _bucket_counts(body["health"]) == {"good": 2, "disability": 1, "unspecified": 1}
    assert [b["key"] for b in body["health"]] == ["good", "disability", "unspecified"]
    assert all(b["label"] is None for b in body["health"])


async def test_education_breakdown_with_unspecified(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)
    for _ in range(2):
        await _make_resident(api, auth_headers, partner_id, dar["id"], education_stage="primary")
    await _make_resident(api, auth_headers, partner_id, dar["id"], education_stage="secondary")
    await _make_resident(api, auth_headers, partner_id, dar["id"])  # education NULL

    body = await _report(api, auth_headers, dar["id"])
    assert _bucket_counts(body["education"]) == {
        "primary": 2,
        "secondary": 1,
        "unspecified": 1,
    }
    assert [b["key"] for b in body["education"]] == ["primary", "secondary", "unspecified"]


async def test_totals_invariant_and_resident_definition(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """sum(health buckets) == sum(education buckets) == residents, and only
    true residents count: a family placement (orphanage_id IS NULL), another
    dar's resident and a soft-deleted resident are all excluded."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)
    other_dar = await _make_dar(api, auth_headers)

    for _ in range(3):
        await _make_resident(api, auth_headers, partner_id, dar["id"])
    deleted = await _make_resident(api, auth_headers, partner_id, dar["id"])
    await _set_orphan(deleted, deleted_at=datetime.now(UTC))
    await _make_resident(api, auth_headers, partner_id, None)  # family placement
    await _make_resident(api, auth_headers, partner_id, other_dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    residents = body["occupancy"]["residents"]
    assert residents == 3
    assert sum(b["count"] for b in body["health"]) == residents
    assert sum(b["count"] for b in body["education"]) == residents
    assert body["sponsorship"]["sponsored"] + body["sponsorship"]["unsponsored"] == residents
    window = body["reports_window"]
    assert window["reported"] + window["not_reported"] == residents


# ── Sponsorship + file aggregates ────────────────────────────────────────


async def test_sponsorship_coverage(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)
    sponsored = await _make_resident(api, auth_headers, partner_id, dar["id"])
    await _set_orphan(sponsored, case_status="sponsored")
    for _ in range(3):
        await _make_resident(api, auth_headers, partner_id, dar["id"])

    body = await _report(api, auth_headers, dar["id"])
    assert body["sponsorship"] == {"sponsored": 1, "unsponsored": 3, "sponsored_pct": 25}


async def test_file_aggregates_threshold_boundary(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """avg_completion is the rounded mean; incomplete counts STRICTLY below
    the threshold — a file at exactly 80 is complete."""
    assert FILE_INCOMPLETE_THRESHOLD == 80
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)
    for pct in (100, 80, 79, 60):
        orphan = await _make_resident(api, auth_headers, partner_id, dar["id"])
        await _set_orphan(orphan, profile_completion_percentage=pct)

    body = await _report(api, auth_headers, dar["id"])
    # mean = 79.75 → 80; 79 and 60 are below the threshold, 80 itself is not.
    assert body["files"] == {"avg_completion": 80, "incomplete_count": 2}


# ── Reporting window ─────────────────────────────────────────────────────


async def test_reports_window(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A resident counts as reported only for a NON-draft report whose
    period_end is inside the window; several qualifying reports still count
    the child once; drafts and out-of-window reports don't count."""
    partner_id = await _seed_partner_id()
    dar = await _make_dar(api, auth_headers)
    in_window = date.today() - timedelta(days=10)
    out_of_window = date.today() - timedelta(days=REPORT_WINDOW_DAYS + 1)

    reported = await _make_resident(api, auth_headers, partner_id, dar["id"])
    await _add_report(reported, status="published_to_donor", period_end=in_window)
    await _add_report(reported, status="org_approved", period_end=in_window)  # counted once

    draft_only = await _make_resident(api, auth_headers, partner_id, dar["id"])
    await _add_report(draft_only, status="draft", period_end=in_window)

    stale = await _make_resident(api, auth_headers, partner_id, dar["id"])
    await _add_report(stale, status="published_to_donor", period_end=out_of_window)

    await _make_resident(api, auth_headers, partner_id, dar["id"])  # never reported

    body = await _report(api, auth_headers, dar["id"])
    assert body["reports_window"] == {
        "window_days": REPORT_WINDOW_DAYS,
        "reported": 1,
        "not_reported": 3,
    }


# ── Isolation ────────────────────────────────────────────────────────────


async def test_manager_reads_own_house_only(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The dar's manager gets their own report (200); ANY other dar — even in
    the same org — is a 404, indistinguishable from an unknown id."""
    org_id = await _seed_org_id()
    partner_id = await _seed_partner_id()
    manager_id, manager_headers = await _make_manager(api, org_id)
    own_dar = await _make_dar(api, auth_headers, capacity=5, manager_user_id=manager_id)
    other_dar = await _make_dar(api, auth_headers)
    await _make_resident(api, auth_headers, partner_id, own_dar["id"])

    body = await _report(api, manager_headers, own_dar["id"])
    assert body["occupancy"]["residents"] == 1
    assert body["occupancy"]["capacity"] == 5

    r = await api.get(f"/api/v1/orphanages/{other_dar['id']}/report", headers=manager_headers)
    assert r.status_code == 404, r.text
    # Same shape as an unknown id — existence is never confirmed.
    r_unknown = await api.get(f"/api/v1/orphanages/{uuid.uuid4()}/report", headers=manager_headers)
    assert r_unknown.status_code == 404
    assert r.json() == r_unknown.json()


async def test_admin_reads_any_house_in_org(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """An org admin reads any dar in their org — including a managed one."""
    org_id = await _seed_org_id()
    manager_id, _ = await _make_manager(api, org_id)
    dar = await _make_dar(api, auth_headers, manager_user_id=manager_id)

    admin_headers = await _login_user(api, org_id, None, role="org_admin")
    body = await _report(api, admin_headers, dar["id"])
    assert body["orphanage_id"] == dar["id"]


async def test_cross_org_isolation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Org B never reads org A's dar report (404), and vice versa."""
    dar = await _make_dar(api, auth_headers)

    foreign_org = await _make_org()
    foreign_admin = await _login_user(api, foreign_org, None, role="org_admin")
    r = await api.get(f"/api/v1/orphanages/{dar['id']}/report", headers=foreign_admin)
    assert r.status_code == 404, r.text

    foreign_jiha = await _make_partner_org(foreign_org)
    foreign_dar = await _make_dar(api, foreign_admin, partner_organization_id=foreign_jiha)
    body = await _report(api, foreign_admin, foreign_dar["id"])
    assert body["orphanage_id"] == foreign_dar["id"]
    r = await api.get(f"/api/v1/orphanages/{foreign_dar['id']}/report", headers=auth_headers)
    assert r.status_code == 404, r.text


async def test_partner_scoping(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A partner-scoped user reads only dars of their own جهة: another جهة's
    dar → 404, and a scoped user with no جهة set reaches nothing."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)
    dar_a = await _make_dar(api, auth_headers, partner_organization_id=jiha_a)
    dar_b = await _make_dar(api, auth_headers, partner_organization_id=jiha_b)

    pm_a = await _login_user(api, org_id, jiha_a)
    body = await _report(api, pm_a, dar_a["id"])
    assert body["orphanage_id"] == dar_a["id"]
    r = await api.get(f"/api/v1/orphanages/{dar_b['id']}/report", headers=pm_a)
    assert r.status_code == 404, r.text

    pm_none = await _login_user(api, org_id, None)
    r = await api.get(f"/api/v1/orphanages/{dar_a['id']}/report", headers=pm_none)
    assert r.status_code == 404, r.text


async def test_report_rejects_non_staff_roles(api: AsyncClient) -> None:
    """Pure consumers (donor) are 403'd by the role gate."""
    org_id = await _seed_org_id()
    donor = await _login_user(api, org_id, None, role="donor")
    r = await api.get(f"/api/v1/orphanages/{uuid.uuid4()}/report", headers=donor)
    assert r.status_code == 403, r.text
