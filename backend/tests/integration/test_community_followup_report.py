"""The community follow-up report (GET /orphans/community-report).

Counts-only aggregate over the OUT-OF-HOME orphans — children living with
family, not in a dar (``orphanage_id IS NULL``, the exact complement of the
house report's residents): the family-governorate breakdown with per-bucket
cadence tallies and the k-anonymity collapse (``count`` AND all three of
``on_track`` / ``due_soon`` / ``overdue`` survive the merge, "unspecified"
never merges into "other"), the reporting-cadence tallies (the house-report
definition verbatim — each child's latest non-draft period_end classified
against the org's effective cadence plus the grace period, never reported
counts as overdue), lives_with / health breakdowns with the explicit
"unspecified" bucket, sponsorship coverage and the file-completion
aggregates (threshold boundary at 80).

Isolation mirrors test_orphan_segments_report.py: org A never sees org B's
counts, a partner-scoped user only their own جهة, a scoped user with no جهة
nothing at all, pure consumers are 403'd.

The session-scoped DB accumulates orphans from the whole suite, so every
test tags the rows it creates with a globally unique marker and scopes its
report calls to that marker — making the asserted result sets exact
regardless of other seeded data.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select, text

from app.api.v1.orphans import SEGMENT_MIN_BUCKET
from app.core.constants import (
    DEFAULT_REPORT_CADENCE_DAYS,
    FILE_INCOMPLETE_THRESHOLD,
    REPORT_OVERDUE_GRACE_DAYS,
)
from app.core.database import make_session
from app.core.security import hash_password
from app.models.family import Family
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
            code=f"CFR-{suffix}",
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
            code=f"CFJ-{suffix}",
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
    password = "communityreportpw123456"
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


async def _make_family(org_id: UUID, governorate: str | None) -> str:
    """A Family row (the governorate the report groups by) in ``org_id``.

    Direct insert: the report only reads ``families.governorate``, and the
    staff address block (OrphanHomeAddress) deliberately carries no
    governorate field to write one through the API."""
    suffix = uuid4().hex[:8]
    async with make_session() as db:
        family = Family(
            organization_id=org_id,
            code=f"CFF-{suffix}",
            governorate=governorate,
        )
        db.add(family)
        await db.commit()
        await db.refresh(family)
        return str(family.id)


async def _make_dar(api: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    """A dar, so a test can prove residents are excluded from this report."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={"name_ar": f"دار-{suffix}", "name_en": f"Dar {suffix}"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    return body


async def _create(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    **fields: object,
) -> str:
    """Create an orphan (no orphanage_id → an out-of-home / community child
    unless a test passes one); return its id."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "first_name": f"متابعة-{suffix}",
        "family_name": "اختبار",
        "date_of_birth": "2014-01-01",
        "gender": "M",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
        **fields,
    }
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


async def _report(api: AsyncClient, headers: dict[str, str], **params: object) -> dict[str, Any]:
    r = await api.get("/api/v1/orphans/community-report", params=params, headers=headers)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def _bucket_counts(buckets: list[dict[str, Any]]) -> dict[str, int]:
    return {b["key"]: b["count"] for b in buckets}


def _gov_tallies(body: dict[str, Any]) -> dict[str, tuple[int, int, int, int]]:
    """governorate → (count, on_track, due_soon, overdue) for exact
    whole-breakdown asserts."""
    return {
        g["governorate"]: (g["count"], g["on_track"], g["due_soon"], g["overdue"])
        for g in body["governorates"]
    }


# ── The out-of-home slice ────────────────────────────────────────────────


async def test_total_counts_only_out_of_home(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """total counts orphans with orphanage_id IS NULL only: a dar resident
    and a soft-deleted community child are both excluded."""
    partner_id = await _seed_partner_id()
    marker = f"cfr-oh-{uuid.uuid4().hex[:8]}"
    dar = await _make_dar(api, auth_headers)

    await _create(api, auth_headers, partner_id, tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])
    await _create(api, auth_headers, partner_id, orphanage_id=dar["id"], tags=[marker])
    deleted = await _create(api, auth_headers, partner_id, tags=[marker])
    await _set_orphan(deleted, deleted_at=datetime.now(UTC))

    body = await _report(api, auth_headers, tags=marker)
    assert body["total"] == 2
    assert sum(g["count"] for g in body["governorates"]) == 2


# ── Governorate breakdown ────────────────────────────────────────────────


async def test_governorate_grouping_and_unspecified(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Grouping is by the FAMILY governorate; a child with no family and a
    child whose family has no governorate share one 'unspecified' bucket."""
    org_id = await _seed_org_id()
    partner_id = await _seed_partner_id()
    marker = f"cfr-gv-{uuid.uuid4().hex[:8]}"
    gov = f"محافظة-{marker}"
    fam = await _make_family(org_id, gov)
    fam_no_gov = await _make_family(org_id, None)

    for _ in range(3):
        await _create(api, auth_headers, partner_id, family_id=fam, tags=[marker])
    await _create(api, auth_headers, partner_id, family_id=fam_no_gov, tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # no family at all

    body = await _report(api, auth_headers, tags=marker)
    assert body["total"] == 5
    # None of the five has any report → every tally lands in overdue.
    assert _gov_tallies(body) == {gov: (3, 0, 0, 3), "unspecified": (2, 0, 0, 2)}
    # Ordered by count desc with a stable tiebreak on the governorate key.
    assert [g["governorate"] for g in body["governorates"]] == [gov, "unspecified"]


async def test_governorate_k_anonymity_preserves_tallies(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Sub-threshold governorates collapse into 'other' carrying EVERY tally
    (count and the three cadence states), while 'unspecified' stays its own
    bucket however small — 'not recorded' and 'too small to show' must never
    blur."""
    assert SEGMENT_MIN_BUCKET == 3
    org_id = await _seed_org_id()
    partner_id = await _seed_partner_id()
    marker = f"cfr-ka-{uuid.uuid4().hex[:8]}"
    in_window = date.today() - timedelta(days=10)

    fam_big = await _make_family(org_id, f"محافظة-كبرى-{marker}")
    fam_rare_a = await _make_family(org_id, f"محافظة-نادرة-أ-{marker}")
    fam_rare_b = await _make_family(org_id, f"محافظة-نادرة-ب-{marker}")

    big_reported = await _create(api, auth_headers, partner_id, family_id=fam_big, tags=[marker])
    await _add_report(big_reported, status="org_approved", period_end=in_window)
    for _ in range(2):
        await _create(api, auth_headers, partner_id, family_id=fam_big, tags=[marker])

    rare_reported = await _create(
        api, auth_headers, partner_id, family_id=fam_rare_a, tags=[marker]
    )
    await _add_report(rare_reported, status="published_to_donor", period_end=in_window)
    await _create(api, auth_headers, partner_id, family_id=fam_rare_b, tags=[marker])

    await _create(api, auth_headers, partner_id, tags=[marker])  # no family → unspecified

    body = await _report(api, auth_headers, tags=marker)
    assert body["total"] == 6
    # The two rare governorates (1 child each) merge into 'other' — their
    # on_track tally (1) moves with them, never lost; the sub-threshold
    # 'unspecified' (1 child) survives as its own bucket.
    assert _gov_tallies(body) == {
        f"محافظة-كبرى-{marker}": (3, 1, 0, 2),
        "other": (2, 1, 0, 1),
        "unspecified": (1, 0, 0, 1),
    }
    rare_names = {g["governorate"] for g in body["governorates"]}
    assert not any("نادرة" in name for name in rare_names)


# ── Reporting cadence ────────────────────────────────────────────────────


async def test_reporting_cadence_classification(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Each child is classified from their LATEST non-draft period_end:
    recent is on_track, within the grace period past the due date is
    due_soon, past the grace period is overdue, and a draft-only or
    never-reported child is overdue. Several qualifying reports still count
    the child once (only the latest matters)."""
    cadence = DEFAULT_REPORT_CADENCE_DAYS  # the seed org has no cadence of its own
    partner_id = await _seed_partner_id()
    marker = f"cfr-rw-{uuid.uuid4().hex[:8]}"
    recent = date.today() - timedelta(days=10)

    on_track = await _create(api, auth_headers, partner_id, tags=[marker])
    await _add_report(on_track, status="published_to_donor", period_end=recent)
    await _add_report(on_track, status="org_approved", period_end=recent)  # counted once

    in_grace = await _create(api, auth_headers, partner_id, tags=[marker])
    await _add_report(
        in_grace, status="org_approved", period_end=date.today() - timedelta(days=cadence + 1)
    )

    draft_only = await _create(api, auth_headers, partner_id, tags=[marker])
    await _add_report(draft_only, status="draft", period_end=recent)

    stale = await _create(api, auth_headers, partner_id, tags=[marker])
    await _add_report(
        stale,
        status="published_to_donor",
        period_end=date.today() - timedelta(days=cadence + REPORT_OVERDUE_GRACE_DAYS + 1),
    )

    await _create(api, auth_headers, partner_id, tags=[marker])  # never reported

    body = await _report(api, auth_headers, tags=marker)
    assert body["reporting"] == {
        "cadence_days": cadence,
        "grace_days": REPORT_OVERDUE_GRACE_DAYS,
        "on_track": 1,
        "due_soon": 1,
        "overdue": 3,
    }
    # The whole slice has no family → one 'unspecified' bucket whose cadence
    # tallies match the top line.
    assert _gov_tallies(body) == {"unspecified": (5, 1, 1, 3)}


# ── lives_with / health breakdowns ───────────────────────────────────────


async def test_lives_with_breakdown_with_unspecified(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """NULL lives_with lands in an explicit 'unspecified' bucket; buckets are
    ordered by count descending with a stable tiebreak on key."""
    partner_id = await _seed_partner_id()
    marker = f"cfr-lw-{uuid.uuid4().hex[:8]}"
    for _ in range(2):
        await _create(api, auth_headers, partner_id, lives_with="mother", tags=[marker])
    await _create(api, auth_headers, partner_id, lives_with="relative", tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # lives_with NULL

    body = await _report(api, auth_headers, tags=marker)
    assert _bucket_counts(body["lives_with"]) == {"mother": 2, "relative": 1, "unspecified": 1}
    assert [b["key"] for b in body["lives_with"]] == ["mother", "relative", "unspecified"]
    assert all(b["label"] is None for b in body["lives_with"])


async def test_health_breakdown_with_unspecified(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    marker = f"cfr-hl-{uuid.uuid4().hex[:8]}"
    for _ in range(2):
        await _create(api, auth_headers, partner_id, health_status="good", tags=[marker])
    await _create(api, auth_headers, partner_id, health_status="disability", tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # health NULL

    body = await _report(api, auth_headers, tags=marker)
    assert _bucket_counts(body["health"]) == {"good": 2, "disability": 1, "unspecified": 1}
    assert [b["key"] for b in body["health"]] == ["good", "disability", "unspecified"]


# ── Sponsorship + file aggregates ────────────────────────────────────────


async def test_sponsorship_coverage(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"cfr-sp-{uuid.uuid4().hex[:8]}"
    sponsored = await _create(api, auth_headers, partner_id, tags=[marker])
    await _set_orphan(sponsored, case_status="sponsored")
    for _ in range(3):
        await _create(api, auth_headers, partner_id, tags=[marker])

    body = await _report(api, auth_headers, tags=marker)
    assert body["sponsorship"] == {"sponsored": 1, "unsponsored": 3, "sponsored_pct": 25}


async def test_file_aggregates_threshold_boundary(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """avg_completion is the rounded mean; incomplete counts STRICTLY below
    the threshold — a file at exactly 80 is complete."""
    assert FILE_INCOMPLETE_THRESHOLD == 80
    partner_id = await _seed_partner_id()
    marker = f"cfr-fi-{uuid.uuid4().hex[:8]}"
    for pct in (100, 80, 79, 60):
        orphan = await _create(api, auth_headers, partner_id, tags=[marker])
        await _set_orphan(orphan, profile_completion_percentage=pct)

    body = await _report(api, auth_headers, tags=marker)
    # mean = 79.75 → 80; 79 and 60 are below the threshold, 80 itself is not.
    assert body["files"] == {"avg_completion": 80, "incomplete_count": 2}


# ── Invariants ───────────────────────────────────────────────────────────


async def test_breakdown_sums_equal_total(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Every breakdown partitions the same slice: sum(governorates) ==
    sum(lives_with) == sum(health) == total, sponsorship and the cadence
    tallies partition it too — top-line AND per governorate."""
    org_id = await _seed_org_id()
    partner_id = await _seed_partner_id()
    marker = f"cfr-in-{uuid.uuid4().hex[:8]}"
    fam = await _make_family(org_id, f"محافظة-{marker}")

    await _create(api, auth_headers, partner_id, family_id=fam, lives_with="mother", tags=[marker])
    await _create(api, auth_headers, partner_id, family_id=fam, health_status="good", tags=[marker])
    await _create(api, auth_headers, partner_id, family_id=fam, tags=[marker])
    reported = await _create(api, auth_headers, partner_id, tags=[marker])
    await _add_report(reported, status="org_approved", period_end=date.today())

    body = await _report(api, auth_headers, tags=marker)
    total = body["total"]
    assert total == 4
    assert sum(g["count"] for g in body["governorates"]) == total
    assert sum(b["count"] for b in body["lives_with"]) == total
    assert sum(b["count"] for b in body["health"]) == total
    assert body["sponsorship"]["sponsored"] + body["sponsorship"]["unsponsored"] == total
    reporting = body["reporting"]
    assert reporting["on_track"] + reporting["due_soon"] + reporting["overdue"] == total
    for state in ("on_track", "due_soon", "overdue"):
        assert sum(g[state] for g in body["governorates"]) == reporting[state]
    for g in body["governorates"]:
        assert g["on_track"] + g["due_soon"] + g["overdue"] == g["count"]


# ── Tenant + جهة scoping ─────────────────────────────────────────────────


async def test_org_isolation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Org A's report never includes org B's children — even for the same
    marker tag — and vice versa."""
    foreign_org = await _make_org()
    foreign_jiha = await _make_partner_org(foreign_org)
    foreign_admin = await _login_user(api, foreign_org, None, role="org_admin")
    marker = f"cfr-iso-{uuid.uuid4().hex[:8]}"
    fam = await _make_family(foreign_org, f"محافظة-{marker}")
    for _ in range(3):
        await _create(api, foreign_admin, foreign_jiha, family_id=fam, tags=[marker])

    dev_view = await _report(api, auth_headers, tags=marker)
    assert dev_view["total"] == 0
    assert dev_view["governorates"] == []
    assert dev_view["lives_with"] == []
    assert dev_view["health"] == []
    assert dev_view["sponsorship"] == {"sponsored": 0, "unsponsored": 0, "sponsored_pct": None}
    assert dev_view["files"] == {"avg_completion": None, "incomplete_count": 0}
    assert dev_view["reporting"] == {
        "cadence_days": DEFAULT_REPORT_CADENCE_DAYS,
        "grace_days": REPORT_OVERDUE_GRACE_DAYS,
        "on_track": 0,
        "due_soon": 0,
        "overdue": 0,
    }

    foreign_view = await _report(api, foreign_admin, tags=marker)
    assert foreign_view["total"] == 3
    assert _gov_tallies(foreign_view) == {f"محافظة-{marker}": (3, 0, 0, 3)}


async def test_partner_scoped_user(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A partner-scoped user counts only their own جهة's children; a scoped
    user with no جهة set sees an empty report."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)
    marker = f"cfr-ps-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, jiha_a, lives_with="mother", tags=[marker])
    await _create(api, auth_headers, jiha_a, tags=[marker])
    await _create(api, auth_headers, jiha_b, tags=[marker])

    pm_a = await _login_user(api, org_id, jiha_a)
    body = await _report(api, pm_a, tags=marker)
    assert body["total"] == 2  # جهة B's child never appears
    assert _bucket_counts(body["lives_with"]) == {"mother": 1, "unspecified": 1}

    pm_none = await _login_user(api, org_id, None)
    body = await _report(api, pm_none, tags=marker)
    assert body["total"] == 0
    assert body["governorates"] == []


async def test_requires_staff_role(api: AsyncClient) -> None:
    """Same gate as list_orphans: pure consumers are 403'd."""
    org_id = await _seed_org_id()
    donor = await _login_user(api, org_id, None, role="donor")
    r = await api.get("/api/v1/orphans/community-report", headers=donor)
    assert r.status_code == 403, r.text
