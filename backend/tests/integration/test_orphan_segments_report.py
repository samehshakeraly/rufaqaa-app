"""The aggregate "orphan segments" report (GET /orphans/segments).

Counts-only grouping over the same filtered slice as the staff orphan list:
per-dimension buckets (coded, derived and joined dimensions), filter
composition, the explicit "unspecified" bucket for NULLs, the k-anonymity
collapse on the sensitive dimensions (governorate, orphanage), and the
org/جهة scoping — org A never sees org B's counts, a partner-scoped user only
their own جهة, a scoped user with no جهة nothing at all.

Also pins list_orphans' composed filter semantics (the WHERE building is
shared with the report via _apply_orphan_filters), so a drift in the helper
refactor would surface here.

The session-scoped DB accumulates orphans from the whole suite, so every test
tags the rows it creates with a globally unique marker and scopes its queries
to that marker — making the asserted result sets exact regardless of other
seeded data.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select, text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.partner import PartnerOrganization
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL


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
    """A separate (foreign) organization, so a test can seed rows that must
    never surface in the DEV org's report."""
    suffix = uuid4().hex[:6]
    async with make_session() as db:
        org = Organization(
            code=f"SEG-{suffix}",
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
            code=f"SGP-{suffix}",
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
    password = "segmentsuserpw123456"
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


async def _create(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    **fields: object,
) -> str:
    """Create an orphan with the given fields; return its id."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "first_name": f"شريحة-{suffix}",
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


async def _create_orphanage(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    governorate: str | None = None,
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={
            "name_ar": f"دار-{suffix}",
            "name_en": f"Dar {suffix}",
            "partner_organization_id": partner_id,
            "governorate": governorate,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    return body


async def _segments(api: AsyncClient, headers: dict[str, str], **params: object) -> dict[str, Any]:
    r = await api.get("/api/v1/orphans/segments", params=params, headers=headers)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def _bucket_counts(body: dict[str, Any]) -> dict[str, int]:
    return {b["key"]: b["count"] for b in body["buckets"]}


async def _list_total(api: AsyncClient, headers: dict[str, str], **params: object) -> int:
    params.setdefault("limit", 1)
    r = await api.get("/api/v1/orphans", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return int(r.json()["total"])


def _dob_years_ago(years: int) -> str:
    """A date of birth ``years`` (plus a ~2-month safety margin) ago, so the
    computed age is stably ``years`` regardless of today's date."""
    return (date.today() - timedelta(days=365 * years + 60)).isoformat()


# ── Coded dimensions ─────────────────────────────────────────────────────


async def test_segments_by_case_status(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-cs-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])
    approved = await _create(api, auth_headers, partner_id, tags=[marker])
    r = await api.post(f"/api/v1/orphans/{approved}/approve", json={}, headers=auth_headers)
    assert r.status_code == 200, r.text

    body = await _segments(api, auth_headers, by="case_status", tags=marker)
    assert body["dimension"] == "case_status"
    assert body["total"] == 3
    assert _bucket_counts(body) == {"pending_review": 2, "approved": 1}
    # Ordered by count desc, and coded buckets carry no label (frontend i18n).
    assert [b["key"] for b in body["buckets"]] == ["pending_review", "approved"]
    assert all(b["label"] is None for b in body["buckets"])


async def test_segments_by_education_stage_null_bucket(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """NULL dimension values land in an explicit 'unspecified' bucket, never
    dropped — so total always equals the filtered orphan count."""
    partner_id = await _seed_partner_id()
    marker = f"seg-edu-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, education_stage="primary", tags=[marker])
    await _create(api, auth_headers, partner_id, education_stage="primary", tags=[marker])
    await _create(api, auth_headers, partner_id, education_stage="secondary", tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # education_stage NULL

    body = await _segments(api, auth_headers, by="education_stage", tags=marker)
    assert body["total"] == 4
    assert _bucket_counts(body) == {"primary": 2, "secondary": 1, "unspecified": 1}
    # Stable tiebreak on key between the two count-1 buckets.
    assert [b["key"] for b in body["buckets"]] == ["primary", "secondary", "unspecified"]


async def test_segments_by_gender_and_lives_with(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-glw-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, gender="M", lives_with="mother", tags=[marker])
    await _create(api, auth_headers, partner_id, gender="F", lives_with="mother", tags=[marker])
    await _create(api, auth_headers, partner_id, gender="F", tags=[marker])  # lives_with NULL

    by_gender = await _segments(api, auth_headers, by="gender", tags=marker)
    assert _bucket_counts(by_gender) == {"M": 1, "F": 2}

    by_lives_with = await _segments(api, auth_headers, by="lives_with", tags=marker)
    assert _bucket_counts(by_lives_with) == {"mother": 2, "unspecified": 1}


async def test_segments_by_health_status_and_priority(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-hp-{uuid.uuid4().hex[:8]}"
    await _create(
        api, auth_headers, partner_id, health_status="good", priority_level="urgent", tags=[marker]
    )
    await _create(api, auth_headers, partner_id, health_status="disability", tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])

    by_health = await _segments(api, auth_headers, by="health_status", tags=marker)
    assert _bucket_counts(by_health) == {"good": 1, "disability": 1, "unspecified": 1}

    by_priority = await _segments(api, auth_headers, by="priority", tags=marker)
    # priority_level is NOT NULL with default 'normal' — no unspecified bucket.
    assert _bucket_counts(by_priority) == {"normal": 2, "urgent": 1}


# ── Derived dimensions (SQL CASE, in-query) ──────────────────────────────


async def test_segments_by_orphan_type(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-ot-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, mother_status="alive", tags=[marker])
    await _create(api, auth_headers, partner_id, mother_status="alive", tags=[marker])
    await _create(api, auth_headers, partner_id, mother_status="deceased", tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # mother_status 'unknown'

    body = await _segments(api, auth_headers, by="orphan_type", tags=marker)
    assert _bucket_counts(body) == {"single": 2, "double": 1, "unknown": 1}


async def test_segments_by_hafiz(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """hafiz == all 30 juz'; NULL juz counts as 'no', mirroring is_hafiz."""
    partner_id = await _seed_partner_id()
    marker = f"seg-hf-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, quran_juz_memorized=30, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=10, tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # NULL juz

    body = await _segments(api, auth_headers, by="hafiz", tags=marker)
    assert _bucket_counts(body) == {"yes": 1, "no": 2}


async def test_segments_by_juz_band(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Band boundaries: 0 / 1-9 / 10-19 / 20-29 / 30, NULL banded with 0."""
    partner_id = await _seed_partner_id()
    marker = f"seg-jb-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, tags=[marker])  # NULL → "0"
    await _create(api, auth_headers, partner_id, quran_juz_memorized=0, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=1, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=9, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=10, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=19, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=20, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=29, tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=30, tags=[marker])

    body = await _segments(api, auth_headers, by="juz_band", tags=marker)
    assert body["total"] == 9
    assert _bucket_counts(body) == {"0": 2, "1-9": 2, "10-19": 2, "20-29": 2, "30": 1}


async def test_segments_by_age_band(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-ab-{uuid.uuid4().hex[:8]}"
    for years, n in ((3, 1), (8, 2), (13, 1), (16, 1), (20, 1)):
        for _ in range(n):
            await _create(
                api, auth_headers, partner_id, date_of_birth=_dob_years_ago(years), tags=[marker]
            )

    body = await _segments(api, auth_headers, by="age_band", tags=marker)
    assert body["total"] == 6
    assert _bucket_counts(body) == {"0-5": 1, "6-11": 2, "12-14": 1, "15-17": 1, "18+": 1}


# ── Joined dimensions ────────────────────────────────────────────────────


async def test_segments_by_partner_labels(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Joined dims key on the id and carry the display name as the label."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)
    marker = f"seg-pt-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, jiha_a, tags=[marker])
    await _create(api, auth_headers, jiha_a, tags=[marker])
    await _create(api, auth_headers, jiha_b, tags=[marker])

    body = await _segments(api, auth_headers, by="partner", tags=marker)
    assert body["total"] == 3
    assert _bucket_counts(body) == {jiha_a: 2, jiha_b: 1}
    labels = {b["key"]: b["label"] for b in body["buckets"]}
    assert labels[jiha_a] is not None and labels[jiha_a].startswith("جهة-")
    assert labels[jiha_b] is not None and labels[jiha_b].startswith("جهة-")


async def test_segments_by_channel(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-ch-{uuid.uuid4().hex[:8]}"
    r = await api.post(
        "/api/v1/marketing-channels",
        json={"name_ar": f"قناة-{marker}", "name_en": f"Channel {marker}"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    channel = r.json()

    assigned = await _create(api, auth_headers, partner_id, tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # unassigned
    r = await api.post(
        f"/api/v1/orphans/{assigned}/assign-channel",
        json={"channel_id": channel["id"]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _segments(api, auth_headers, by="channel", tags=marker)
    assert _bucket_counts(body) == {channel["id"]: 1, "unspecified": 1}
    labels = {b["key"]: b["label"] for b in body["buckets"]}
    assert labels[channel["id"]] == f"قناة-{marker}"
    assert labels["unspecified"] is None


async def test_segments_by_orphanage_k_anonymity(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Buckets under SEGMENT_MIN_BUCKET (3) collapse into 'other' for the
    sensitive orphanage dimension; counts move, the total is preserved."""
    partner_id = await _seed_partner_id()
    marker = f"seg-oa-{uuid.uuid4().hex[:8]}"
    dar_big = await _create_orphanage(api, auth_headers, partner_id)
    dar_small = await _create_orphanage(api, auth_headers, partner_id)
    for _ in range(3):
        await _create(api, auth_headers, partner_id, orphanage_id=dar_big["id"], tags=[marker])
    await _create(api, auth_headers, partner_id, orphanage_id=dar_small["id"], tags=[marker])
    await _create(api, auth_headers, partner_id, tags=[marker])  # no dar

    body = await _segments(api, auth_headers, by="orphanage", tags=marker)
    assert body["total"] == 5
    # dar_small (1) and the NULL bucket (1) both fall under the floor → one
    # combined 'other'; the identifiable small dar never appears by id.
    assert _bucket_counts(body) == {dar_big["id"]: 3, "other": 2}
    labels = {b["key"]: b["label"] for b in body["buckets"]}
    assert labels[dar_big["id"]] == dar_big["name_ar"]
    assert labels["other"] is None


async def test_segments_by_orphanage_no_collapse_at_threshold(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Buckets at/above the floor (including 'unspecified') survive intact."""
    partner_id = await _seed_partner_id()
    marker = f"seg-ok-{uuid.uuid4().hex[:8]}"
    dar = await _create_orphanage(api, auth_headers, partner_id)
    for _ in range(3):
        await _create(api, auth_headers, partner_id, orphanage_id=dar["id"], tags=[marker])
    for _ in range(3):
        await _create(api, auth_headers, partner_id, tags=[marker])  # no dar

    body = await _segments(api, auth_headers, by="orphanage", tags=marker)
    assert _bucket_counts(body) == {dar["id"]: 3, "unspecified": 3}


async def test_segments_by_governorate_k_anonymity(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """governorate groups by the HOUSE (dar) governorate and applies the same
    k-anonymity floor. Two dars in the same governorate share one bucket."""
    partner_id = await _seed_partner_id()
    marker = f"seg-gv-{uuid.uuid4().hex[:8]}"
    gov_big = f"محافظة-كبرى-{marker}"
    gov_rare = f"محافظة-نادرة-{marker}"
    dar_a = await _create_orphanage(api, auth_headers, partner_id, governorate=gov_big)
    dar_b = await _create_orphanage(api, auth_headers, partner_id, governorate=gov_big)
    dar_rare = await _create_orphanage(api, auth_headers, partner_id, governorate=gov_rare)
    await _create(api, auth_headers, partner_id, orphanage_id=dar_a["id"], tags=[marker])
    await _create(api, auth_headers, partner_id, orphanage_id=dar_a["id"], tags=[marker])
    await _create(api, auth_headers, partner_id, orphanage_id=dar_b["id"], tags=[marker])
    await _create(api, auth_headers, partner_id, orphanage_id=dar_rare["id"], tags=[marker])

    body = await _segments(api, auth_headers, by="governorate", tags=marker)
    assert body["total"] == 4
    # The rare governorate (1 child) collapses into 'other' — it must never be
    # identifiable; the big one keeps its name as key AND label.
    assert _bucket_counts(body) == {gov_big: 3, "other": 1}
    labels = {b["key"]: b["label"] for b in body["buckets"]}
    assert labels[gov_big] == gov_big
    assert labels["other"] is None


# ── Filters compose with grouping ────────────────────────────────────────


async def test_segments_filters_compose(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The report is 'the filtered slice, grouped': a health_status filter
    narrows the education_stage buckets exactly like it narrows the list."""
    partner_id = await _seed_partner_id()
    marker = f"seg-fc-{uuid.uuid4().hex[:8]}"
    await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="primary",
        health_status="good",
        tags=[marker],
    )
    await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="primary",
        health_status="disability",
        tags=[marker],
    )
    await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="secondary",
        health_status="good",
        tags=[marker],
    )

    body = await _segments(
        api, auth_headers, by="education_stage", tags=marker, health_status="good"
    )
    assert body["total"] == 2
    assert _bucket_counts(body) == {"primary": 1, "secondary": 1}

    body = await _segments(api, auth_headers, by="education_stage", tags=marker, is_hafiz="false")
    assert body["total"] == 3  # nobody memorised 30 juz' in this slice


async def test_segments_total_equals_sum_and_list_total(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    marker = f"seg-tt-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, partner_id, education_stage="primary", tags=[marker])
    await _create(api, auth_headers, partner_id, health_status="good", tags=[marker])
    await _create(api, auth_headers, partner_id, quran_juz_memorized=30, tags=[marker])

    for by in ("case_status", "education_stage", "hafiz", "orphanage", "governorate"):
        body = await _segments(api, auth_headers, by=by, tags=marker)
        assert body["total"] == sum(b["count"] for b in body["buckets"]), by
        assert body["total"] == await _list_total(api, auth_headers, tags=marker), by


# ── Tenant + جهة scoping ─────────────────────────────────────────────────


async def test_segments_org_isolation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Org A's report never includes org B's orphans — even for the same
    marker tag — and vice versa."""
    foreign_org = await _make_org()
    foreign_jiha = await _make_partner_org(foreign_org)
    foreign_admin = await _login_user(api, foreign_org, None, role="org_admin")
    marker = f"seg-iso-{uuid.uuid4().hex[:8]}"
    await _create(api, foreign_admin, foreign_jiha, tags=[marker])
    await _create(api, foreign_admin, foreign_jiha, tags=[marker])

    dev_view = await _segments(api, auth_headers, by="case_status", tags=marker)
    assert dev_view["total"] == 0
    assert dev_view["buckets"] == []

    foreign_view = await _segments(api, foreign_admin, by="case_status", tags=marker)
    assert foreign_view["total"] == 2
    assert _bucket_counts(foreign_view) == {"pending_review": 2}


async def test_segments_partner_scoped_user(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A partner-scoped user counts only their own جهة; a scoped user with no
    جهة set sees an empty report."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)
    marker = f"seg-ps-{uuid.uuid4().hex[:8]}"
    await _create(api, auth_headers, jiha_a, tags=[marker])
    await _create(api, auth_headers, jiha_a, tags=[marker])
    await _create(api, auth_headers, jiha_b, tags=[marker])

    pm_a = await _login_user(api, org_id, jiha_a)
    body = await _segments(api, pm_a, by="partner", tags=marker)
    assert body["total"] == 2
    assert _bucket_counts(body) == {jiha_a: 2}  # جهة B never appears

    pm_none = await _login_user(api, org_id, None)
    body = await _segments(api, pm_none, by="case_status", tags=marker)
    assert body["total"] == 0
    assert body["buckets"] == []


async def test_segments_requires_staff_role(api: AsyncClient) -> None:
    """Same gate as list_orphans: pure consumers are 403'd."""
    org_id = await _seed_org_id()
    donor = await _login_user(api, org_id, None, role="donor")
    r = await api.get("/api/v1/orphans/segments", params={"by": "case_status"}, headers=donor)
    assert r.status_code == 403, r.text


async def test_segments_rejects_unknown_dimension(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(
        "/api/v1/orphans/segments", params={"by": "national_id"}, headers=auth_headers
    )
    assert r.status_code == 422, r.text


# ── list_orphans regression after the _apply_orphan_filters refactor ─────


async def test_list_orphans_composed_filters_unchanged(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Pins list_orphans' composed filter semantics now that the WHERE
    building is shared with /orphans/segments: stacking segment + advanced
    filters must select exactly the same rows as before the refactor."""
    partner_id = await _seed_partner_id()
    marker = f"seg-rg-{uuid.uuid4().hex[:8]}"
    match = await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="primary",
        health_status="good",
        quran_juz_memorized=12,
        mother_status="alive",
        priority_level="high",
        tags=[marker, "extra"],
    )
    # Each of these misses exactly one of the stacked filters below.
    await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="secondary",
        health_status="good",
        quran_juz_memorized=12,
        mother_status="alive",
        priority_level="high",
        tags=[marker],
    )
    await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="primary",
        health_status="good",
        quran_juz_memorized=5,
        mother_status="alive",
        priority_level="high",
        tags=[marker],
    )
    await _create(
        api,
        auth_headers,
        partner_id,
        education_stage="primary",
        health_status="good",
        quran_juz_memorized=12,
        mother_status="deceased",
        priority_level="high",
        tags=[marker],
    )

    r = await api.get(
        "/api/v1/orphans",
        params={
            "limit": 100,
            "tags": marker,
            "education_stage": "primary",
            "health_status": "good",
            "min_juz": 10,
            "is_hafiz": "false",
            "orphan_type": "single",
            "priority": "high",
            "min_completion": 0,
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["total"] == 1
    assert [item["id"] for item in page["items"]] == [match]
    # The response envelope and row shape the frontend relies on are intact.
    assert {"items", "total", "limit", "offset"} <= set(page)
    row = page["items"][0]
    assert row["education_stage"] == "primary"
    assert row["is_hafiz"] is False
    assert row["priority_level"] == "high"
