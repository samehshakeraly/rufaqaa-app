"""profile_completion_percentage is computed for real on create + update.

Locks the contract that the (previously dead) ``profile_completion_percentage``
now reflects the equal-weighted measure over seven enrichment fields — both on
the shared create path and on PATCH — while the unused sibling
``profile_completion_score`` stays at its 0 default, and the derived value
never leaks into the audit trail.
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


async def _completion(orphan_id: str) -> tuple[int, int]:
    """Read the stored percentage + (unused) score straight from the row."""
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT profile_completion_percentage, profile_completion_score "
                    "FROM orphans WHERE id = :id"
                ),
                {"id": orphan_id},
            )
        ).first()
    assert row is not None
    return int(row[0]), int(row[1])


async def test_create_computes_percentage_from_subset(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]

    # 3 of the 7 enrichment fields filled → round(3 / 7 * 100) == 43.
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"اكتمال-{suffix}",
            "family_name": "جزئي",
            "date_of_birth": "2015-01-01",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
            "nationality": "PS",
            "education_stage": "primary",
            "school_name": "Al-Noor School",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    orphan_id = r.json()["id"]

    pct, score = await _completion(orphan_id)
    assert pct == 43
    assert score == 0  # the sibling column is left untouched


async def test_patch_adding_fields_increases_percentage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]

    # Start with just nationality → 1 / 7 → 14.
    created = (
        await api.post(
            "/api/v1/orphans",
            json={
                "first_name": f"ترقية-{suffix}",
                "family_name": "اكتمال",
                "date_of_birth": "2014-02-02",
                "gender": "F",
                "partner_organization_id": partner_id,
                "father_name": f"أب-{suffix}",
                "nationality": "EG",
                # EG is a documented country: its national_id is now required at
                # create (PR-3b). It is not a profile-completion field, so this
                # does not change the percentages asserted below. A fresh 14-digit
                # id keeps it unique per org (PR A's blind-index uniqueness).
                "national_id": f"{uuid.uuid4().int % 10**14:014d}",
            },
            headers=auth_headers,
        )
    ).json()
    orphan_id = created["id"]
    pct_before, _ = await _completion(orphan_id)
    assert pct_before == 14

    # PATCH fills four more fields (quran_juz_memorized=0 counts as known) →
    # 5 / 7 → 71.
    r = await api.patch(
        f"/api/v1/orphans/{orphan_id}",
        json={
            "education_stage": "primary",
            "school_name": "Future School",
            "quran_juz_memorized": 0,
            "aspiration": "To become an engineer",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    pct_after, score_after = await _completion(orphan_id)
    assert pct_after == 71
    assert pct_after > pct_before
    assert score_after == 0  # still untouched

    # The recompute happens after the audit `changes` dict is built, so the
    # derived field must NOT appear in the orphan.updated old/new values.
    audit = await api.get(
        f"/api/v1/audit?entity_type=orphan&entity_id={orphan_id}&limit=10",
        headers=auth_headers,
    )
    assert audit.status_code == 200, audit.text
    updates = [e for e in audit.json()["items"] if e["action"] == "orphan.updated"]
    assert updates, "expected an orphan.updated audit entry"
    for entry in updates:
        assert "profile_completion_percentage" not in (entry["new_values"] or {})
        assert "profile_completion_percentage" not in (entry["old_values"] or {})
