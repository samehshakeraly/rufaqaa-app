"""Advanced filters on the staff orphan list (GET /orphans).

Exercises the four advanced filters end-to-end against the org-scoped staff
endpoint: ``orphan_type`` (derived from ``mother_status``), ``priority``
(matches ``priority_level`` exactly), ``min_waiting_days`` (days since
``available_since``, NULL excluded), and ``min_completion`` (a ``>=`` bound on
``profile_completion_percentage``).

Like the segment-filter and sort suites, every test tags the rows it creates
with a globally unique marker and scopes its queries to that marker — so the
asserted result sets are exact regardless of the other orphans the session has
accumulated. ``mother_status`` / ``priority_level`` are real create fields and
go in through the API; ``available_since`` / ``profile_completion_percentage``
can't be set at creation (a fresh orphan lands ``pending_review`` with
``available_since`` NULL and a derived completion), so they're written straight
onto the row.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
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
    """Create an orphan (lands pending_review); return its id."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, object] = {
        "first_name": f"متقدم-{suffix}",
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


async def _set_fields(orphan_id: str, **cols: object) -> None:
    """Set filter-relevant columns straight on an orphan row — used for the
    ones the create payload can't set (``available_since`` is NULL on a fresh
    pending_review orphan; ``profile_completion_percentage`` is derived).

    Column names come only from test code (never user input), so interpolating
    them into the UPDATE is safe; values stay bound parameters.
    """
    assignments = ", ".join(f"{c} = :{c}" for c in cols)
    async with make_session() as db:
        await db.execute(
            text(f"UPDATE orphans SET {assignments} WHERE id = CAST(:id AS uuid)"),
            {"id": orphan_id, **cols},
        )
        await db.commit()


async def _list(api: AsyncClient, headers: dict[str, str], **params: object) -> dict[str, Any]:
    params.setdefault("limit", 100)
    r = await api.get("/api/v1/orphans", params=params, headers=headers)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def _ids(body: dict[str, Any]) -> set[str]:
    return {item["id"] for item in body["items"]}


async def test_filter_orphan_type(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """orphan_type is derived from mother_status: single → alive (father lost,
    mother alive), double → deceased. The unknown-mother orphan surfaces only
    when orphan_type is omitted — there's no explicit value for it."""
    partner_id = await _seed_partner_id()
    marker = f"otype-{uuid.uuid4().hex[:8]}"
    single = await _create(api, auth_headers, partner_id, mother_status="alive", tags=[marker])
    double = await _create(api, auth_headers, partner_id, mother_status="deceased", tags=[marker])
    unknown = await _create(api, auth_headers, partner_id, mother_status="unknown", tags=[marker])

    # Omitted → every row, including the unknown-mother one.
    assert _ids(await _list(api, auth_headers, tags=marker)) == {single, double, unknown}

    # single → only mother alive; double → only mother deceased.
    assert _ids(await _list(api, auth_headers, tags=marker, orphan_type="single")) == {single}
    assert _ids(await _list(api, auth_headers, tags=marker, orphan_type="double")) == {double}

    # The unknown-mother orphan never appears under either explicit value.
    assert unknown not in _ids(await _list(api, auth_headers, tags=marker, orphan_type="single"))
    assert unknown not in _ids(await _list(api, auth_headers, tags=marker, orphan_type="double"))


async def test_filter_priority(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """priority matches priority_level exactly."""
    partner_id = await _seed_partner_id()
    marker = f"prio-{uuid.uuid4().hex[:8]}"
    normal = await _create(api, auth_headers, partner_id, priority_level="normal", tags=[marker])
    high = await _create(api, auth_headers, partner_id, priority_level="high", tags=[marker])
    urgent = await _create(api, auth_headers, partner_id, priority_level="urgent", tags=[marker])

    assert _ids(await _list(api, auth_headers, tags=marker)) == {normal, high, urgent}
    assert _ids(await _list(api, auth_headers, tags=marker, priority="normal")) == {normal}
    assert _ids(await _list(api, auth_headers, tags=marker, priority="high")) == {high}
    assert _ids(await _list(api, auth_headers, tags=marker, priority="urgent")) == {urgent}


async def test_filter_min_waiting_days(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """min_waiting_days keeps orphans whose available_since is at least that
    many days in the past; a NULL available_since is always excluded."""
    partner_id = await _seed_partner_id()
    marker = f"wait-{uuid.uuid4().hex[:8]}"
    waited_100 = await _create(api, auth_headers, partner_id, tags=[marker])
    waited_10 = await _create(api, auth_headers, partner_id, tags=[marker])
    waited_1 = await _create(api, auth_headers, partner_id, tags=[marker])
    never = await _create(api, auth_headers, partner_id, tags=[marker])  # available_since NULL

    now = datetime.now(UTC)
    await _set_fields(waited_100, available_since=now - timedelta(days=100))
    await _set_fields(waited_10, available_since=now - timedelta(days=10))
    await _set_fields(waited_1, available_since=now - timedelta(days=1))

    # min_waiting_days=0 still applies (0 is not None): every row that ever
    # entered the pool (non-NULL available_since in the past), NULL excluded.
    assert _ids(await _list(api, auth_headers, tags=marker, min_waiting_days=0)) == {
        waited_100,
        waited_10,
        waited_1,
    }
    # >= 5 days waiting drops the 1-day-old row.
    assert _ids(await _list(api, auth_headers, tags=marker, min_waiting_days=5)) == {
        waited_100,
        waited_10,
    }
    # >= 50 days leaves only the long waiter.
    assert _ids(await _list(api, auth_headers, tags=marker, min_waiting_days=50)) == {waited_100}
    # The NULL-available_since row never satisfies a waiting bound.
    assert never not in _ids(await _list(api, auth_headers, tags=marker, min_waiting_days=0))


async def test_filter_min_completion(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """min_completion is a >= threshold on profile_completion_percentage."""
    partner_id = await _seed_partner_id()
    marker = f"compl-{uuid.uuid4().hex[:8]}"
    c0 = await _create(api, auth_headers, partner_id, tags=[marker])
    c50 = await _create(api, auth_headers, partner_id, tags=[marker])
    c100 = await _create(api, auth_headers, partner_id, tags=[marker])
    await _set_fields(c0, profile_completion_percentage=0)
    await _set_fields(c50, profile_completion_percentage=50)
    await _set_fields(c100, profile_completion_percentage=100)

    # min_completion=0 keeps everything (>= 0).
    assert _ids(await _list(api, auth_headers, tags=marker, min_completion=0)) == {c0, c50, c100}
    # >= 50 drops the 0% row.
    assert _ids(await _list(api, auth_headers, tags=marker, min_completion=50)) == {c50, c100}
    # >= 100 keeps only the fully-complete row.
    assert _ids(await _list(api, auth_headers, tags=marker, min_completion=100)) == {c100}


async def test_advanced_filters_validation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Out-of-domain / out-of-range values are 422'd by the param validators."""
    # orphan_type only accepts single|double.
    r = await api.get("/api/v1/orphans", params={"orphan_type": "triple"}, headers=auth_headers)
    assert r.status_code == 422
    # priority mirrors PriorityLevel (normal|high|urgent).
    r = await api.get("/api/v1/orphans", params={"priority": "critical"}, headers=auth_headers)
    assert r.status_code == 422
    # min_waiting_days >= 0.
    r = await api.get("/api/v1/orphans", params={"min_waiting_days": -1}, headers=auth_headers)
    assert r.status_code == 422
    # min_completion is bounded 0–100.
    r = await api.get("/api/v1/orphans", params={"min_completion": 101}, headers=auth_headers)
    assert r.status_code == 422
