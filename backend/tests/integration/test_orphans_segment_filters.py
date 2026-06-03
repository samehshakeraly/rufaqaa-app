"""Segment filters on the staff orphan list (GET /orphans).

Exercises the org-scoped staff endpoint's segment filters end-to-end:
education_stage, health_status, the derived is_hafiz (== 30 juz', with NULL
treated as "not a hafiz"), min_juz, and the tags array (@> "all" vs && "any").

The session-scoped DB accumulates orphans from the whole suite, so every test
tags the rows it creates with a globally unique marker and scopes its queries
to that marker — making the asserted result sets exact regardless of other
seeded data.
"""

from __future__ import annotations

import uuid
from typing import Any

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


async def _create(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    **fields: object,
) -> str:
    """Create an orphan with the given segment fields; return its id."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "first_name": f"فلتر-{suffix}",
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


async def _list(api: AsyncClient, headers: dict[str, str], **params: object) -> dict[str, Any]:
    params.setdefault("limit", 100)
    r = await api.get("/api/v1/orphans", params=params, headers=headers)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def _ids(body: dict[str, Any]) -> set[str]:
    return {item["id"] for item in body["items"]}


async def test_filter_education_stage(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"edu-{uuid.uuid4().hex[:8]}"
    primary = await _create(api, auth_headers, partner_id, education_stage="primary", tags=[marker])
    secondary = await _create(
        api, auth_headers, partner_id, education_stage="secondary", tags=[marker]
    )

    # Marker isolates exactly the two rows we just created.
    assert _ids(await _list(api, auth_headers, tags=marker)) == {primary, secondary}

    assert _ids(await _list(api, auth_headers, tags=marker, education_stage="primary")) == {primary}
    assert _ids(await _list(api, auth_headers, tags=marker, education_stage="secondary")) == {
        secondary
    }


async def test_filter_health_status(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"hs-{uuid.uuid4().hex[:8]}"
    good = await _create(api, auth_headers, partner_id, health_status="good", tags=[marker])
    chronic = await _create(
        api, auth_headers, partner_id, health_status="chronic_condition", tags=[marker]
    )

    assert _ids(await _list(api, auth_headers, tags=marker, health_status="good")) == {good}
    assert _ids(await _list(api, auth_headers, tags=marker, health_status="chronic_condition")) == {
        chronic
    }


async def test_filter_is_hafiz(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"haf-{uuid.uuid4().hex[:8]}"
    hafiz = await _create(api, auth_headers, partner_id, quran_juz_memorized=30, tags=[marker])
    partial = await _create(api, auth_headers, partner_id, quran_juz_memorized=10, tags=[marker])
    none_juz = await _create(api, auth_headers, partner_id, tags=[marker])  # quran_juz NULL

    assert _ids(await _list(api, auth_headers, tags=marker)) == {hafiz, partial, none_juz}

    # is_hafiz=true → only the child who has memorised all 30 juz'.
    assert _ids(await _list(api, auth_headers, tags=marker, is_hafiz="true")) == {hafiz}

    # is_hafiz=false → everyone else, INCLUDING the NULL-juz child (IS DISTINCT FROM 30).
    assert _ids(await _list(api, auth_headers, tags=marker, is_hafiz="false")) == {
        partial,
        none_juz,
    }


async def test_filter_min_juz_boundary(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    marker = f"juz-{uuid.uuid4().hex[:8]}"
    j0 = await _create(api, auth_headers, partner_id, quran_juz_memorized=0, tags=[marker])
    j5 = await _create(api, auth_headers, partner_id, quran_juz_memorized=5, tags=[marker])
    j30 = await _create(api, auth_headers, partner_id, quran_juz_memorized=30, tags=[marker])
    jnull = await _create(api, auth_headers, partner_id, tags=[marker])  # NULL juz

    # min_juz=0 still applies (0 is not None): keeps every non-NULL juz, drops NULL.
    assert _ids(await _list(api, auth_headers, tags=marker, min_juz=0)) == {j0, j5, j30}
    # min_juz=5 keeps only >= 5; NULL stays excluded.
    assert _ids(await _list(api, auth_headers, tags=marker, min_juz=5)) == {j5, j30}
    # Upper boundary: only the 30-juz child clears min_juz=30.
    assert _ids(await _list(api, auth_headers, tags=marker, min_juz=30)) == {j30}
    # The NULL-juz row never satisfies a min_juz bound.
    assert jnull not in _ids(await _list(api, auth_headers, tags=marker, min_juz=0))


async def test_filter_tags_all_vs_any(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _seed_partner_id()
    run = uuid.uuid4().hex[:8]
    a, b, c = f"{run}-a", f"{run}-b", f"{run}-c"
    both = await _create(api, auth_headers, partner_id, tags=[a, b])
    just_a = await _create(api, auth_headers, partner_id, tags=[a])
    just_c = await _create(api, auth_headers, partner_id, tags=[c])

    # all (@>): the row must contain *every* supplied tag.
    assert _ids(await _list(api, auth_headers, tags=[a, b], tags_mode="all")) == {both}
    assert _ids(await _list(api, auth_headers, tags=[a], tags_mode="all")) == {both, just_a}

    # any (&&): the row needs to overlap *at least one* supplied tag.
    assert _ids(await _list(api, auth_headers, tags=[a, c], tags_mode="any")) == {
        both,
        just_a,
        just_c,
    }
    assert _ids(await _list(api, auth_headers, tags=[b], tags_mode="any")) == {both}
