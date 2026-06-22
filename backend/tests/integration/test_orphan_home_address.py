"""Conditional family materialisation on the STAFF orphan-create path (PR B2).

When a staff registration captures a home address for a family-resident child
and pins no ``family_id``, the shared ``create_orphan_record`` chokepoint builds
a Family from that address **in the same transaction** and links the orphan to
it. The address columns already exist on ``families`` (migration 0021), so there
is no new migration. The rules under test:

* ≥1 non-empty address field + no family_id  → a Family is created (correct
  organization_id / partner_organization_id / country_code = nationality
  upper-cased / address fields) and the orphan's family_id points to it;
* family_id already supplied                  → the address is IGNORED (no new
  Family, the pinned family is never mutated);
* an all-empty / whitespace-only address      → no Family at all;
* the guardian self-service schema has no ``home_address`` field
  (``extra='forbid'``), so that path is untouched and rejects it outright.

Like the rest of tests/integration these need a real Postgres with the
migrations + seed applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.database import make_session
from app.models.family import Family
from app.models.orphan import Orphan
from tests.integration.test_guardian_self import (
    _create_family_and_guardian,
    _link_family_to_partner,
    _seed_partner_id,
)


def _identity_payload(**overrides: Any) -> dict[str, Any]:
    """A minimal, unique orphan-identity payload. Unique names dodge the
    no-duplicate 409 so each test is independent. ``nationality`` defaults to the
    permissive KW baseline (no national_id required); it must be a real country
    code (the orphans.nationality FK targets ``countries.code``)."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, Any] = {
        "first_name": f"بيت-{suffix}",
        "family_name": "اختبار",
        "date_of_birth": "2015-06-01",
        "gender": "M",
        "father_name": f"أب-{suffix}",
        "nationality": "KW",
    }
    payload.update(overrides)
    return payload


# ── Staff path (POST /orphans) ──────────────────────────────────────────


async def test_staff_create_with_home_address_materialises_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A staff create with a home address and no family_id spins up a Family
    (org/partner/country_code/address all correct) and links the orphan to it."""
    partner_id = await _seed_partner_id()
    # A unique city pinpoints exactly the family this create spawned.
    city = f"city-{uuid.uuid4().hex[:10]}"
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="mother",
        home_address={
            "city": city,
            "village": "  قرية  ",  # surrounding whitespace must be trimmed
            "district": "الحي",
            "street": "الشارع 1",
            "house_number": "12",
            "floor": "3",
        },
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["family_id"] is not None

    async with make_session() as db:
        orphan = await db.get(Orphan, uuid.UUID(body["id"]))
        assert orphan is not None
        assert orphan.family_id is not None
        family = await db.get(Family, orphan.family_id)
    assert family is not None
    # Linked to the orphan, scoped to the same org + partner جهة as the orphan.
    assert family.id == orphan.family_id
    assert family.organization_id == orphan.organization_id
    assert str(family.partner_organization_id) == partner_id
    assert family.partner_organization_id == orphan.partner_organization_id
    # country_code mirrors the orphan's nationality, upper-cased.
    assert family.country_code == "KW"
    assert family.country_code == (orphan.nationality or "").upper()
    # Address fields copied across; the village was whitespace-trimmed.
    assert family.city == city
    assert family.village == "قرية"
    assert family.district == "الحي"
    assert family.street == "الشارع 1"
    assert family.house_number == "12"
    assert family.floor == "3"
    # Materialised through the same generate_code("FAM") path as create_family.
    assert family.code.startswith("FAM-")


async def test_staff_create_with_family_id_ignores_home_address(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """When the payload already pins a family_id, the home address is ignored:
    no new Family is created and the pinned family is never mutated."""
    partner_id = await _seed_partner_id()
    # An existing family to pin the orphan to.
    fr = await api.post(
        "/api/v1/families",
        json={"partner_organization_id": partner_id, "family_name": "existing"},
        headers=auth_headers,
    )
    assert fr.status_code == 201, fr.text
    family_id = fr.json()["id"]

    city = f"ignored-{uuid.uuid4().hex[:10]}"
    payload = _identity_payload(
        partner_organization_id=partner_id,
        family_id=family_id,
        lives_with="mother",
        home_address={"city": city, "street": "should be ignored"},
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    # The orphan stays pinned to the supplied family.
    assert r.json()["family_id"] == family_id

    async with make_session() as db:
        # No family was spawned from the ignored address.
        spawned = await db.scalar(select(func.count(Family.id)).where(Family.city == city))
        assert spawned == 0
        # The pinned family was NOT mutated with the address.
        existing = await db.get(Family, uuid.UUID(family_id))
        assert existing is not None
        assert existing.city is None
        assert existing.street is None


async def test_staff_create_all_empty_home_address_creates_no_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An all-empty / whitespace-only home address creates no Family — the
    orphan's family_id stays NULL."""
    partner_id = await _seed_partner_id()
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="mother",
        home_address={
            "city": "",
            "village": "   ",  # whitespace only → empty after trim
            "district": "",
            "street": "",
            "house_number": "",
            "floor": "",
        },
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    assert r.json()["family_id"] is None


async def test_staff_create_rolls_back_family_when_orphan_insert_conflicts(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The conditional Family shares the orphan's transaction. When the orphan
    insert is rejected at flush time — here a duplicate national_id in the org,
    keyed on the blind index and caught only by the IntegrityError backstop
    (→ 409) — the just-materialised Family unwinds with it. No orphan, no family."""
    partner_id = await _seed_partner_id()
    national_id = f"dup-{uuid.uuid4().hex[:10]}"
    # First orphan claims the national_id for the org (no home address). KW is the
    # permissive baseline, so any non-empty national_id is accepted as-is.
    first = await api.post(
        "/api/v1/orphans",
        json=_identity_payload(partner_organization_id=partner_id, national_id=national_id),
        headers=auth_headers,
    )
    assert first.status_code == 201, first.text

    # Second orphan: a DISTINCT identity (so the name/dob/father pre-check passes)
    # that reuses the national_id AND carries a home address. national_id
    # uniqueness is enforced only by uq_orphans_national_id_per_org at flush, so
    # the Family is materialised first, then the orphan insert violates the index
    # → 409 and the whole transaction unwinds.
    city = f"rollback-{uuid.uuid4().hex[:10]}"
    second = await api.post(
        "/api/v1/orphans",
        json=_identity_payload(
            partner_organization_id=partner_id,
            national_id=national_id,
            lives_with="relative",
            home_address={"city": city},
        ),
        headers=auth_headers,
    )
    assert second.status_code == 409, second.text

    async with make_session() as db:
        spawned = await db.scalar(select(func.count(Family.id)).where(Family.city == city))
    assert spawned == 0  # the Family was rolled back with the failed orphan insert


# ── Guardian self-service path (POST /guardian/me/orphans) ──────────────


async def test_guardian_create_rejects_home_address_field(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The guardian self-service schema has no ``home_address`` field and forbids
    extras, so a guardian payload carrying one is rejected (422) — the guardian
    path is unchanged. The same payload without it still creates the orphan."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    suffix = uuid.uuid4().hex[:6]
    base = {
        "first_name": f"g-{suffix}",
        "family_name": "Guarded",
        "date_of_birth": "2016-03-12",
        "gender": "M",
        "father_name": f"father-{suffix}",
        "nationality": "KW",
        "lives_with": "mother",
    }

    rejected = await api.post(
        "/api/v1/guardian/me/orphans",
        json={**base, "home_address": {"city": "nope"}},
        headers=headers,
    )
    assert rejected.status_code == 422, rejected.text

    # Without the forbidden field the create succeeds and lands in the
    # guardian's own family (derived server-side, never an address-spawned one).
    ok = await api.post("/api/v1/guardian/me/orphans", json=base, headers=headers)
    assert ok.status_code == 201, ok.text
