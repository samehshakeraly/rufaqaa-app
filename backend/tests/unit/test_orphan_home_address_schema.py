"""Unit tests for the GPS extension to ``OrphanHomeAddress`` (PR E).

Pure Pydantic — no DB. They lock down the validation contract the staff
orphan-create path relies on before any coordinate ever reaches the family's
PostGIS ``coordinates`` column:

* latitude/longitude are both-or-neither (a lone axis is a 422);
* each axis is range-checked to valid WGS84 bounds;
* ``has_content()`` treats a full GPS pair as content (so a GPS-only block still
  materialises a family), and ``0.0`` counts as a real coordinate.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.orphan import OrphanHomeAddress


def test_both_coordinates_accepted() -> None:
    addr = OrphanHomeAddress(latitude=15.5, longitude=32.25)
    assert addr.latitude == 15.5
    assert addr.longitude == 32.25
    assert addr.has_content() is True


def test_neither_coordinate_is_fine() -> None:
    addr = OrphanHomeAddress()
    assert addr.latitude is None
    assert addr.longitude is None
    # No address and no GPS → nothing to materialise a family from.
    assert addr.has_content() is False


@pytest.mark.parametrize(
    "payload",
    [
        {"latitude": 15.5},  # longitude missing
        {"longitude": 32.25},  # latitude missing
    ],
)
def test_exactly_one_coordinate_is_rejected(payload: dict[str, float]) -> None:
    with pytest.raises(ValidationError):
        OrphanHomeAddress(**payload)


@pytest.mark.parametrize(
    "lat,lng",
    [
        (-91, 0),  # latitude below -90
        (91, 0),  # latitude above 90
        (0, -181),  # longitude below -180
        (0, 181),  # longitude above 180
    ],
)
def test_out_of_range_coordinates_are_rejected(lat: float, lng: float) -> None:
    with pytest.raises(ValidationError):
        OrphanHomeAddress(latitude=lat, longitude=lng)


@pytest.mark.parametrize("bound", [(-90.0, -180.0), (90.0, 180.0), (0.0, 0.0)])
def test_boundary_and_zero_coordinates_accepted(bound: tuple[float, float]) -> None:
    lat, lng = bound
    addr = OrphanHomeAddress(latitude=lat, longitude=lng)
    assert addr.latitude == lat
    assert addr.longitude == lng
    # 0.0 is the equator / prime meridian — a real point, so it is "content".
    assert addr.has_content() is True


def test_gps_only_block_has_content_without_any_address_field() -> None:
    """A GPS-only submission (no address fields) must still count as content so
    the staff create path materialises a family for it."""
    addr = OrphanHomeAddress(latitude=1.0, longitude=2.0)
    assert addr.city is None
    assert addr.has_content() is True


def test_address_only_block_has_content_without_coordinates() -> None:
    addr = OrphanHomeAddress(city="Khartoum")
    assert addr.latitude is None
    assert addr.longitude is None
    assert addr.has_content() is True
