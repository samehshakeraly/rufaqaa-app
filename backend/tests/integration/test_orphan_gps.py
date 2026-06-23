"""GPS capture on the STAFF orphan-create path (PR E).

When a staff registration carries a latitude/longitude pair inside its
``home_address`` block, the shared ``create_orphan_record`` chokepoint writes it
into the materialised family's EXISTING ``families.coordinates`` POINT — via a
PostGIS ``ST_SetSRID(ST_MakePoint(...), 4326)::point`` write, in the same
transaction, with no new column and no GeoAlchemy2. ``FamilyRead`` then derives
``latitude``/``longitude`` back out with ``ST_Y``/``ST_X`` (the raw geometry is
never exposed). The rules under test:

* a full GPS pair (with or without address fields) → the family's coordinates is
  set and ``FamilyRead`` round-trips the same lat/lng (small float tolerance);
* a GPS-only block (no address field at all) still materialises the family;
* exactly one of latitude/longitude → 422 (schema both-or-neither);
* an out-of-range value → 422;
* no coordinates supplied → the column stays NULL and the read is null/null.

Like the rest of tests/integration these need a real Postgres+PostGIS with the
migrations + seed applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from tests.integration.test_guardian_self import _seed_partner_id
from tests.integration.test_orphan_home_address import _identity_payload

# WGS84 coordinates round-trip through double precision; an exact-ish tolerance
# is plenty (the stored point is the same float we sent).
_TOL = 1e-6


async def _coordinates_raw(family_id: str) -> tuple[float | None, float | None]:
    """Read the family's POINT straight from the column via PostGIS, bypassing
    the API — confirms the write actually landed in ``families.coordinates``."""
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT ST_Y(coordinates::geometry) AS lat, "
                    "ST_X(coordinates::geometry) AS lng "
                    "FROM families WHERE id = :id"
                ),
                {"id": family_id},
            )
        ).first()
    assert row is not None
    return row.lat, row.lng


async def _get_family(api: AsyncClient, headers: dict[str, str], family_id: str) -> dict[str, Any]:
    r = await api.get(f"/api/v1/families/{family_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def test_staff_create_with_gps_sets_family_coordinates(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A staff create carrying lat/lng (alongside an address) sets the family's
    coordinates POINT, and FamilyRead derives the same lat/lng back."""
    partner_id = await _seed_partner_id()
    lat, lng = 15.5007, 32.5599  # Khartoum-ish
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="mother",
        home_address={"city": "الخرطوم", "latitude": lat, "longitude": lng},
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    family_id = r.json()["family_id"]
    assert family_id is not None

    # Straight from the column: the write landed.
    raw_lat, raw_lng = await _coordinates_raw(family_id)
    assert raw_lat == pytest.approx(lat, abs=_TOL)
    assert raw_lng == pytest.approx(lng, abs=_TOL)

    # And the read endpoint round-trips it (never exposing the raw geometry).
    fam = await _get_family(api, auth_headers, family_id)
    assert fam["latitude"] == pytest.approx(lat, abs=_TOL)
    assert fam["longitude"] == pytest.approx(lng, abs=_TOL)
    # The address still came through too — GPS rides alongside it.
    assert fam["city"] == "الخرطوم"


async def test_staff_create_gps_only_materialises_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A GPS-only block (no address fields, and lives_with not even a
    family-residence value) still materialises a family and sets its
    coordinates — has_content() treats a full pair as content."""
    partner_id = await _seed_partner_id()
    lat, lng = -1.2921, 36.8219  # Nairobi-ish; negative latitude exercised
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="orphanage",
        home_address={"latitude": lat, "longitude": lng},
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    family_id = r.json()["family_id"]
    assert family_id is not None  # GPS-only still spins up the family

    fam = await _get_family(api, auth_headers, family_id)
    assert fam["latitude"] == pytest.approx(lat, abs=_TOL)
    assert fam["longitude"] == pytest.approx(lng, abs=_TOL)
    # No address was sent, so those stay null — only the point was captured.
    assert fam["city"] is None


async def test_staff_create_one_coordinate_is_422(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Exactly one of latitude/longitude is rejected before anything persists."""
    partner_id = await _seed_partner_id()
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="mother",
        home_address={"city": "x", "latitude": 15.5},  # longitude missing
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 422, r.text


async def test_staff_create_out_of_range_coordinate_is_422(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An out-of-range axis is a 422 (here latitude beyond the poles)."""
    partner_id = await _seed_partner_id()
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="mother",
        home_address={"latitude": 200.0, "longitude": 10.0},
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 422, r.text


async def test_staff_create_without_gps_leaves_coordinates_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An address-only block creates the family but leaves coordinates NULL, and
    FamilyRead reads lat/lng as null — no point is fabricated."""
    partner_id = await _seed_partner_id()
    city = f"nogps-{uuid.uuid4().hex[:10]}"
    payload = _identity_payload(
        partner_organization_id=partner_id,
        lives_with="mother",
        home_address={"city": city},
    )
    r = await api.post("/api/v1/orphans", json=payload, headers=auth_headers)
    assert r.status_code == 201, r.text
    family_id = r.json()["family_id"]
    assert family_id is not None

    raw_lat, raw_lng = await _coordinates_raw(family_id)
    assert raw_lat is None
    assert raw_lng is None

    fam = await _get_family(api, auth_headers, family_id)
    assert fam["latitude"] is None
    assert fam["longitude"] is None
