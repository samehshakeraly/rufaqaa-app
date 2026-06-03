"""Orphan availability + priority fields (migration 0009).

Covers the *foundation* batch only — the data fields plus the
``available_since`` setter. No filters/sorting/sponsorship-minimum yet.

* ``mother_status`` / ``priority_level`` round-trip on create + PATCH + read,
  and fall back to their defaults ('unknown' / 'normal') when omitted.
* The DB-level CHECK constraints reject out-of-set values.
* ``available_since`` is NULL on a fresh (pending_review) orphan, gets stamped
  the moment the case is released into the available pool, and is **never**
  overwritten on a subsequent release.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

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


async def _create_orphan(api: AsyncClient, headers: dict[str, str], **extra: object) -> dict:
    suffix = uuid.uuid4().hex[:6]
    payload: dict[str, object] = {
        "first_name": f"إتاحة-{suffix}",
        "family_name": "حالة",
        "date_of_birth": "2015-05-05",
        "gender": "M",
        "partner_organization_id": await _seed_partner_id(),
        "father_name": f"أب-{suffix}",
        **extra,
    }
    r = await api.post("/api/v1/orphans", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_mother_status_priority_default_when_omitted(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    body = await _create_orphan(api, auth_headers)
    assert body["mother_status"] == "unknown"
    assert body["priority_level"] == "normal"
    # Fresh orphans land in pending_review, so they are not yet available.
    assert body["available_since"] is None


async def test_mother_status_priority_round_trip_on_create_and_read(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    body = await _create_orphan(
        api, auth_headers, mother_status="deceased", priority_level="urgent"
    )
    assert body["mother_status"] == "deceased"
    assert body["priority_level"] == "urgent"

    # Re-read independently to confirm the values were persisted, not echoed.
    got = await api.get(f"/api/v1/orphans/{body['id']}", headers=auth_headers)
    assert got.status_code == 200, got.text
    read = got.json()
    assert read["mother_status"] == "deceased"
    assert read["priority_level"] == "urgent"


async def test_mother_status_priority_round_trip_on_patch(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    body = await _create_orphan(api, auth_headers)
    orphan_id = body["id"]

    r = await api.patch(
        f"/api/v1/orphans/{orphan_id}",
        json={"mother_status": "alive", "priority_level": "high"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    patched = r.json()
    assert patched["mother_status"] == "alive"
    assert patched["priority_level"] == "high"

    got = await api.get(f"/api/v1/orphans/{orphan_id}", headers=auth_headers)
    assert got.json()["mother_status"] == "alive"
    assert got.json()["priority_level"] == "high"


@pytest.mark.parametrize(
    "column,bad_value",
    [("mother_status", "married"), ("priority_level", "critical")],
)
async def test_check_constraints_reject_bad_values(
    api: AsyncClient, auth_headers: dict[str, str], column: str, bad_value: str
) -> None:
    # The API's Literal types reject bad values at validation time, so drive
    # the DB directly to prove the CHECK constraint is the real backstop.
    body = await _create_orphan(api, auth_headers)
    orphan_id = body["id"]

    with pytest.raises(IntegrityError):
        async with make_session() as db:
            await db.execute(
                text(f"UPDATE orphans SET {column} = :v WHERE id = :id"),
                {"v": bad_value, "id": orphan_id},
            )
            await db.commit()


async def test_available_since_set_on_release_and_not_overwritten(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    body = await _create_orphan(api, auth_headers)
    orphan_id = body["id"]
    assert body["available_since"] is None

    # pending_review → approved → available (release stamps available_since).
    r = await api.post(f"/api/v1/orphans/{orphan_id}/approve", headers=auth_headers)
    assert r.status_code == 200, r.text
    r = await api.post(f"/api/v1/orphans/{orphan_id}/release", headers=auth_headers)
    assert r.status_code == 200, r.text
    released = r.json()
    assert released["case_status"] == "available"
    first_available_since = released["available_since"]
    assert first_available_since is not None

    # Bounce it back out of the pool, then release again. The second release
    # must NOT overwrite the original availability anchor.
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status = 'approved' WHERE id = :id"),
            {"id": orphan_id},
        )
        await db.commit()

    r = await api.post(f"/api/v1/orphans/{orphan_id}/release", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["available_since"] == first_available_since
