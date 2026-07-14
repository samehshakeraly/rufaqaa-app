"""Pure-math tests for app.services.fx (no DB required)."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from app.services import fx


async def test_get_rate_identity_skips_db() -> None:
    # base == quote must short-circuit BEFORE any DB access — passing a
    # non-session proves no query can have run.
    rate = await fx.get_rate(
        None,  # type: ignore[arg-type]
        organization_id=uuid4(),
        base_currency="KWD",
        quote_currency="KWD",
    )
    assert rate == Decimal(1)


async def test_get_rate_identity_is_case_insensitive() -> None:
    rate = await fx.get_rate(
        None,  # type: ignore[arg-type]
        organization_id=uuid4(),
        base_currency="usd",
        quote_currency="USD",
    )
    assert rate == Decimal(1)


@pytest.mark.parametrize(
    ("amount", "rate", "expected"),
    [
        ("100.00", "0.30750000", "30.75"),
        ("10.00", "1", "10.00"),
        ("1.00", "0.33333333", "0.33"),
        # ROUND_HALF_UP at the 2dp boundary.
        ("1.00", "0.005", "0.01"),
        ("3.00", "0.335", "1.01"),
        ("7.77", "12.34567890", "95.93"),
    ],
)
def test_convert_quantizes_half_up(amount: str, rate: str, expected: str) -> None:
    assert fx.convert(Decimal(amount), Decimal(rate)) == Decimal(expected)
