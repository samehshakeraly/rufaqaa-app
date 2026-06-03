"""Sort control on the staff orphan list (GET /orphans).

Exercises the ``sort`` query param end-to-end against the org-scoped staff
endpoint: each named sort's ORDER BY, the ``Orphan.id`` tiebreaker, NULLS LAST
behaviour for ``available_since``, and the resolution precedence
(explicit sort > relevance-when-`q` > newest).

Like the segment-filter suite, every test tags the rows it creates with a
globally unique marker and scopes its queries to that marker — so the asserted
ordering is exact regardless of the other orphans the session has accumulated.
The ordering inputs (``available_since`` / ``priority_level`` /
``profile_completion_percentage`` / ``created_at``) are set straight on the row
because new orphans land in ``pending_review`` with ``available_since`` NULL.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# A fixed anchor well clear of the suite's "now"-stamped rows; marker filtering
# isolates our rows anyway, so only their *relative* values matter.
_BASE = datetime(2020, 1, 1, 12, 0, 0, tzinfo=UTC)


def _t(days: int) -> datetime:
    return _BASE + timedelta(days=days)


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
        "first_name": f"ترتيب-{suffix}",
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
    """Set sort-relevant columns directly on an orphan row.

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


def _order(body: dict[str, Any]) -> list[str]:
    """Returned ids in result order (marker filtering makes this exactly the
    rows the test created)."""
    return [item["id"] for item in body["items"]]


async def test_sort_available_since_both_directions(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """recently_available = available_since DESC NULLS LAST;
    longest_waiting = available_since ASC NULLS LAST. The NULL row is last in
    *both* directions."""
    partner_id = await _seed_partner_id()
    marker = f"sort-as-{uuid.uuid4().hex[:8]}"
    a = await _create(api, auth_headers, partner_id, tags=[marker])
    b = await _create(api, auth_headers, partner_id, tags=[marker])
    c = await _create(api, auth_headers, partner_id, tags=[marker])
    none_one = await _create(api, auth_headers, partner_id, tags=[marker])  # available_since NULL
    await _set_fields(a, available_since=_t(10))
    await _set_fields(b, available_since=_t(5))
    await _set_fields(c, available_since=_t(1))

    recent = await _list(api, auth_headers, tags=marker, sort="recently_available")
    assert _order(recent) == [a, b, c, none_one]

    longest = await _list(api, auth_headers, tags=marker, sort="longest_waiting")
    assert _order(longest) == [c, b, a, none_one]


async def test_sort_priority_then_available_since(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """priority = rank DESC (urgent>high>normal), then available_since DESC
    NULLS LAST. Rank dominates even when a lower-priority row is far more
    recently available."""
    partner_id = await _seed_partner_id()
    marker = f"sort-pr-{uuid.uuid4().hex[:8]}"
    urgent_old = await _create(api, auth_headers, partner_id, tags=[marker])
    urgent_new = await _create(api, auth_headers, partner_id, tags=[marker])
    high = await _create(api, auth_headers, partner_id, tags=[marker])
    normal = await _create(api, auth_headers, partner_id, tags=[marker])
    await _set_fields(urgent_old, priority_level="urgent", available_since=_t(1))
    await _set_fields(urgent_new, priority_level="urgent", available_since=_t(9))
    await _set_fields(high, priority_level="high", available_since=_t(100))
    await _set_fields(normal, priority_level="normal", available_since=_t(200))

    body = await _list(api, auth_headers, tags=marker, sort="priority")
    # urgent (newer available first) → high → normal, despite normal/high having
    # the largest available_since values.
    assert _order(body) == [urgent_new, urgent_old, high, normal]


async def test_sort_most_complete(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """most_complete = profile_completion_percentage DESC."""
    partner_id = await _seed_partner_id()
    marker = f"sort-mc-{uuid.uuid4().hex[:8]}"
    c90 = await _create(api, auth_headers, partner_id, tags=[marker])
    c50 = await _create(api, auth_headers, partner_id, tags=[marker])
    c10 = await _create(api, auth_headers, partner_id, tags=[marker])
    await _set_fields(c90, profile_completion_percentage=90)
    await _set_fields(c50, profile_completion_percentage=50)
    await _set_fields(c10, profile_completion_percentage=10)

    body = await _list(api, auth_headers, tags=marker, sort="most_complete")
    assert _order(body) == [c90, c50, c10]


async def test_sort_newest_and_default_match(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """newest = created_at DESC, and the unset default (no `sort`, no `q`)
    resolves to the very same order."""
    partner_id = await _seed_partner_id()
    marker = f"sort-nw-{uuid.uuid4().hex[:8]}"
    n1 = await _create(api, auth_headers, partner_id, tags=[marker])
    n2 = await _create(api, auth_headers, partner_id, tags=[marker])
    n3 = await _create(api, auth_headers, partner_id, tags=[marker])
    await _set_fields(n1, created_at=_t(1))
    await _set_fields(n2, created_at=_t(2))
    await _set_fields(n3, created_at=_t(3))

    explicit = await _list(api, auth_headers, tags=marker, sort="newest")
    assert _order(explicit) == [n3, n2, n1]

    # Unset sort + no search term → backend auto-picks newest (same order).
    default = await _list(api, auth_headers, tags=marker)
    assert _order(default) == [n3, n2, n1]


async def test_sort_id_tiebreaker(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Ties on the primary key fall back to Orphan.id ascending, so paging is
    deterministic. (Canonical lowercase UUID text sorts the same as Postgres'
    uuid ordering, so sorting the ids in Python mirrors the DB.)"""
    partner_id = await _seed_partner_id()
    marker = f"sort-tb-{uuid.uuid4().hex[:8]}"
    ids = [await _create(api, auth_headers, partner_id, tags=[marker]) for _ in range(3)]
    same = _t(7)
    for oid in ids:
        await _set_fields(oid, available_since=same)

    body = await _list(api, auth_headers, tags=marker, sort="recently_available")
    assert _order(body) == sorted(ids)


async def test_explicit_sort_overrides_relevance(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Precedence: an explicit `sort` wins even when `q` is present. The `q`
    text-match still filters the rows; only the ORDER BY follows `sort`."""
    partner_id = await _seed_partner_id()
    marker = f"sort-ov-{uuid.uuid4().hex[:8]}"
    token = f"needle{uuid.uuid4().hex[:6]}"
    older = await _create(
        api, auth_headers, partner_id, first_name=f"{token}-alpha", tags=[marker]
    )
    newer = await _create(
        api, auth_headers, partner_id, first_name=f"{token}-beta", tags=[marker]
    )
    await _set_fields(older, available_since=_t(1))
    await _set_fields(newer, available_since=_t(9))

    # q matches both rows; sort flips the order deterministically by
    # available_since rather than relevance.
    recent = await _list(api, auth_headers, tags=marker, q=token, sort="recently_available")
    assert _order(recent) == [newer, older]
    longest = await _list(api, auth_headers, tags=marker, q=token, sort="longest_waiting")
    assert _order(longest) == [older, newer]

    # Sanity: without `sort`, the same `q` still returns exactly the matches
    # (relevance order; we only assert the set here).
    relevance = await _list(api, auth_headers, tags=marker, q=token)
    assert set(_order(relevance)) == {older, newer}


async def test_invalid_sort_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Unknown sort values are 422'd by the Literal — notably ``balanced``,
    which is intentionally not part of this batch."""
    r = await api.get("/api/v1/orphans", params={"sort": "balanced"}, headers=auth_headers)
    assert r.status_code == 422
