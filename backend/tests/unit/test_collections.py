"""Pure late-payment derivation rules (app.core.collections)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.core.collections import (
    amount_outstanding,
    installments_due,
    is_late_payer,
    late_payment_cutoff,
    months_behind,
    months_elapsed,
)
from app.core.constants import LATE_PAYMENT_GRACE_DAYS

TODAY = date(2026, 7, 23)


def test_cutoff_is_grace_days_back() -> None:
    assert late_payment_cutoff(TODAY) == TODAY - timedelta(days=LATE_PAYMENT_GRACE_DAYS)
    assert late_payment_cutoff(TODAY, grace_days=0) == TODAY


# ── is_late_payer: the grace boundary ───────────────────────────────────


def test_due_exactly_grace_days_ago_is_not_late() -> None:
    on_boundary = TODAY - timedelta(days=LATE_PAYMENT_GRACE_DAYS)
    assert is_late_payer("active", on_boundary, TODAY) is False


def test_due_one_day_past_grace_is_late() -> None:
    past = TODAY - timedelta(days=LATE_PAYMENT_GRACE_DAYS + 1)
    assert is_late_payer("active", past, TODAY) is True
    assert is_late_payer("overdue", past, TODAY) is True


def test_due_in_future_or_unset_is_not_late() -> None:
    assert is_late_payer("active", TODAY + timedelta(days=3), TODAY) is False
    assert is_late_payer("active", None, TODAY) is False


def test_only_active_like_statuses_are_late() -> None:
    long_past = TODAY - timedelta(days=90)
    for chased in ("active", "overdue"):
        assert is_late_payer(chased, long_past, TODAY) is True
    for exempt in ("paused", "cancelled", "completed", "pending"):
        assert is_late_payer(exempt, long_past, TODAY) is False


# ── months arithmetic ───────────────────────────────────────────────────


def test_months_elapsed_basic() -> None:
    start = date(2026, 1, 15)
    assert months_elapsed(start, date(2026, 1, 20)) == 0
    assert months_elapsed(start, date(2026, 2, 14)) == 0  # day before anniversary
    assert months_elapsed(start, date(2026, 2, 15)) == 1  # anniversary completes the month
    assert months_elapsed(start, date(2027, 1, 15)) == 12
    assert months_elapsed(start, date(2025, 12, 1)) == 0  # today before start


def test_months_elapsed_clamps_anniversary_day_at_28() -> None:
    # Jan 31 start completes its first month on Feb 28 (mirrors how
    # next_payment_date is scheduled with day clamped at 28).
    assert months_elapsed(date(2026, 1, 31), date(2026, 2, 27)) == 0
    assert months_elapsed(date(2026, 1, 31), date(2026, 2, 28)) == 1


def test_installments_due_caps_at_committed_term() -> None:
    start = date(2025, 1, 1)
    assert installments_due(start, None, TODAY) == 18
    assert installments_due(start, date(2025, 7, 1), TODAY) == 6  # 6-month commitment
    assert installments_due(start, date(2030, 1, 1), TODAY) == 18  # cap not reached


def test_months_behind_counts_the_due_installment_itself() -> None:
    assert months_behind(TODAY, TODAY) == 1
    assert months_behind(TODAY - timedelta(days=10), TODAY) == 1
    assert months_behind(date(2026, 6, 23), TODAY) == 2  # one full month + the due one
    assert months_behind(date(2026, 4, 1), TODAY) == 4
    assert months_behind(TODAY + timedelta(days=1), TODAY) == 0


def test_amount_outstanding_scales_and_quantizes() -> None:
    assert amount_outstanding(Decimal("20.00"), 3) == Decimal("60.00")
    assert amount_outstanding(Decimal("12.5"), 2) == Decimal("25.00")
    assert amount_outstanding(Decimal("20.00"), 0) == Decimal("0.00")
