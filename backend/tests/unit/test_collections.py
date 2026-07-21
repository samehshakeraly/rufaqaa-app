"""Pure late-payment rules (core/collections) — no DB required.

Covers the lateness boundary (months_overdue 0 → 1, eligible statuses),
month-elapsed arithmetic including the day-of-month boundary and the
end-date cap, and outstanding-amount arithmetic including currency
conversion and the unknown-rate case.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.core.collections import (
    LATE_SPONSORSHIP_STATUSES,
    MIN_MONTHS_OVERDUE,
    amount_outstanding,
    installments_due,
    is_late,
    months_elapsed,
    outstanding_in_default_currency,
)

# ── is_late: the selection boundary ─────────────────────────────────────


def test_is_late_boundary_zero_vs_one_month() -> None:
    assert not is_late("active", 0)
    assert is_late("active", 1)  # exactly one missed installment is late
    assert is_late("active", 3)


def test_is_late_none_months_counts_as_zero() -> None:
    assert not is_late("active", None)


def test_is_late_only_for_running_statuses() -> None:
    assert is_late("overdue", 1)  # worker-parked late rows stay visible
    for status in ("paused", "cancelled", "completed"):
        assert not is_late(status, 5)


def test_is_late_constants_match_the_documented_rule() -> None:
    # The SQL filter in the late-payers report uses these same constants;
    # pin them so a change there is a conscious, test-visible decision.
    assert LATE_SPONSORSHIP_STATUSES == ("active", "overdue")
    assert MIN_MONTHS_OVERDUE == 1


# ── months_elapsed ──────────────────────────────────────────────────────


def test_months_elapsed_same_month_is_zero() -> None:
    assert months_elapsed(date(2026, 7, 1), date(2026, 7, 21)) == 0


def test_months_elapsed_day_boundary() -> None:
    start = date(2026, 1, 15)
    assert months_elapsed(start, date(2026, 2, 14)) == 0  # day before the mark
    assert months_elapsed(start, date(2026, 2, 15)) == 1  # exactly one month
    assert months_elapsed(start, date(2026, 7, 21)) == 6


def test_months_elapsed_across_year_boundary() -> None:
    assert months_elapsed(date(2025, 11, 10), date(2026, 2, 10)) == 3


def test_months_elapsed_future_start_is_zero() -> None:
    assert months_elapsed(date(2026, 9, 1), date(2026, 7, 21)) == 0


def test_months_elapsed_capped_at_end_date() -> None:
    start = date(2025, 1, 1)
    # Committed until 2025-07-01: only 6 months ever elapse, however far
    # past the end date "today" runs.
    assert months_elapsed(start, date(2026, 7, 21), end=date(2025, 7, 1)) == 6
    # An end date still in the future caps nothing.
    assert months_elapsed(start, date(2025, 4, 1), end=date(2026, 1, 1)) == 3


def test_months_elapsed_end_of_month_starts() -> None:
    # Jan 31 → Feb 28 is not yet a full month (day 28 < day 31).
    assert months_elapsed(date(2026, 1, 31), date(2026, 2, 28)) == 0
    assert months_elapsed(date(2026, 1, 31), date(2026, 3, 31)) == 2


# ── installments_due ────────────────────────────────────────────────────


def test_installments_due_is_paid_plus_behind() -> None:
    assert installments_due(4, 2) == 6
    assert installments_due(0, 1) == 1
    assert installments_due(None, None) == 0


# ── outstanding amounts ─────────────────────────────────────────────────


def test_amount_outstanding_product_two_places() -> None:
    assert amount_outstanding(Decimal("20.00"), 3) == Decimal("60.00")
    assert amount_outstanding(Decimal("12.50"), 0) == Decimal("0.00")
    assert amount_outstanding(Decimal("12.50"), None) == Decimal("0.00")


def test_outstanding_same_currency_needs_no_rate() -> None:
    out = outstanding_in_default_currency(
        Decimal("20.00"),
        2,
        currency="kwd",  # case-insensitive match
        default_currency="KWD",
        exchange_rate=None,
    )
    assert out == Decimal("40.00")


def test_outstanding_foreign_currency_uses_rate() -> None:
    out = outstanding_in_default_currency(
        Decimal("100.00"),
        3,
        currency="USD",
        default_currency="KWD",
        exchange_rate=Decimal("0.3075"),
    )
    assert out == Decimal("92.25")  # 300 × 0.3075, quantized to 2 places


def test_outstanding_foreign_currency_without_rate_is_unknown() -> None:
    out = outstanding_in_default_currency(
        Decimal("100.00"),
        3,
        currency="USD",
        default_currency="KWD",
        exchange_rate=None,
    )
    assert out is None  # never fabricate a converted figure
