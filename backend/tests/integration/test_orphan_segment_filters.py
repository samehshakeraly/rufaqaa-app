"""Profile-based segment filters on the staff GET /orphans endpoint.

Seeds a small cohort of orphans with varied education_stage,
quran_juz_memorized, health_status and tags, then asserts each new filter
(education_stage, health_status, is_hafiz true/false, min_juz, tags all/any)
narrows the list correctly. Filters compose with AND semantics and leave the
Page/OrphanRead response shape unchanged.
"""

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


async def _create_orphan(
    api: AsyncClient,
    auth_headers: dict[str, str],
    partner_id: str,
    *,
    tag_marker: str,
    education_stage: str | None = None,
    health_status: str | None = None,
    quran_juz_memorized: int | None = None,
    tags: list[str] | None = None,
) -> str:
    """Create one orphan and return its id. ``tag_marker`` is appended to every
    tag (and used as a name suffix) so a test run only ever matches its own
    rows even though the DB is shared across tests."""
    suffix = uuid.uuid4().hex[:6]
    payload: dict[str, object] = {
        "first_name": f"شريحة-{suffix}",
        "family_name": "تصنيف",
        "date_of_birth": "2014-01-01",
        "gender": "M",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
    }
    if education_stage is not None:
        payload["education_stage"] = education_stage
    if health_status is not None:
        payload["health_status"] = health_status
    if quran_juz_memorized is not None:
        payload["quran_juz_memorized"] = quran_juz_memorized
    scoped_tags = [f"{t}-{tag_marker}" for t in (tags or [])]
    if scoped_tags:
        payload["tags"] = scoped_tags
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _ids(api: AsyncClient, auth_headers: dict[str, str], query: str) -> set[str]:
    """All matching orphan ids across pages (limit maxed to keep it simple)."""
    r = await api.get(f"/api/v1/orphans?limit=100&{query}", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    # Response shape is unchanged: a Page of OrphanRead.
    assert set(body) >= {"items", "total", "limit", "offset"}
    return {item["id"] for item in body["items"]}


async def test_education_stage_filter(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    primary = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, education_stage="primary"
    )
    secondary = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, education_stage="secondary"
    )

    got = await _ids(api, auth_headers, "education_stage=primary")
    assert primary in got
    assert secondary not in got


async def test_health_status_filter(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    good = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, health_status="good"
    )
    chronic = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, health_status="chronic_condition"
    )

    got = await _ids(api, auth_headers, "health_status=chronic_condition")
    assert chronic in got
    assert good not in got


async def test_is_hafiz_true_and_false(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    hafiz = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, quran_juz_memorized=30
    )
    partial = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, quran_juz_memorized=10
    )
    # No quran value recorded → not a hafiz, and excluded from the true set.
    unrecorded = await _create_orphan(api, auth_headers, partner_id, tag_marker=marker)

    true_set = await _ids(api, auth_headers, "is_hafiz=true")
    assert hafiz in true_set
    assert partial not in true_set
    assert unrecorded not in true_set

    false_set = await _ids(api, auth_headers, "is_hafiz=false")
    assert hafiz not in false_set
    # < 30 and NULL both count as non-hafiz.
    assert partial in false_set
    assert unrecorded in false_set


async def test_min_juz_threshold(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    low = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, quran_juz_memorized=5
    )
    mid = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, quran_juz_memorized=15
    )
    unrecorded = await _create_orphan(api, auth_headers, partner_id, tag_marker=marker)

    got = await _ids(api, auth_headers, "min_juz=10")
    assert mid in got
    assert low not in got
    # NULL is excluded by a >= threshold.
    assert unrecorded not in got


async def test_tags_all_match(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    both = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, tags=["hafiz", "top_student"]
    )
    only_one = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, tags=["hafiz"]
    )

    got = await _ids(
        api, auth_headers, f"tags=hafiz-{marker}&tags=top_student-{marker}&tags_match=all"
    )
    # @> requires ALL requested tags to be present.
    assert both in got
    assert only_one not in got


async def test_tags_any_match(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    both = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, tags=["hafiz", "top_student"]
    )
    only_one = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, tags=["hafiz"]
    )
    neither = await _create_orphan(
        api, auth_headers, partner_id, tag_marker=marker, tags=["needs_glasses"]
    )

    got = await _ids(
        api, auth_headers, f"tags=hafiz-{marker}&tags=top_student-{marker}&tags_match=any"
    )
    # && (overlap) keeps anyone sharing at least one requested tag.
    assert both in got
    assert only_one in got
    assert neither not in got


async def test_filters_compose_with_and_semantics(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    marker = uuid.uuid4().hex[:8]
    match = await _create_orphan(
        api,
        auth_headers,
        partner_id,
        tag_marker=marker,
        education_stage="secondary",
        quran_juz_memorized=30,
        tags=["scholarship"],
    )
    # Same tag + hafiz, but wrong education_stage → excluded by AND.
    wrong_stage = await _create_orphan(
        api,
        auth_headers,
        partner_id,
        tag_marker=marker,
        education_stage="primary",
        quran_juz_memorized=30,
        tags=["scholarship"],
    )

    got = await _ids(
        api,
        auth_headers,
        f"education_stage=secondary&is_hafiz=true&tags=scholarship-{marker}",
    )
    assert match in got
    assert wrong_stage not in got
