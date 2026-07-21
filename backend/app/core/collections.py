"""Pure late-payment (collections) rules — no DB, no session, fully unit-testable.

The sponsorship model already carries the authoritative overdue state: the
daily worker (``app.workers.tasks.sponsorships.mark_overdue_sponsorships``)
advances ``months_overdue`` whenever ``next_payment_date`` slips into the
past, moving the row to status ``overdue``. The grace window is therefore
embodied in how ``next_payment_date`` is scheduled — this module does NOT
re-derive overdue from raw payment history and needs no grace constant of
its own.

What it centralises instead is everything the late-payers report computes
from that state, mirroring ``core/reporting.py``'s hybrid pattern: the
row-level :func:`is_late` and the report's SQL filter both derive from the
same two constants (:data:`LATE_SPONSORSHIP_STATUSES`,
:data:`MIN_MONTHS_OVERDUE`), so the predicate and the row builder can
never drift.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

# A sponsorship only counts as late while it is still running. ``active``
# covers rows the worker has not visited yet (or manually adjusted rows);
# ``overdue`` is where the worker parks a late active sponsorship. Paused /
# cancelled / completed sponsorships never surface as late — mirrors the
# existing finance filters on GET /sponsorships and GET /payments.
LATE_SPONSORSHIP_STATUSES: tuple[str, ...] = ("active", "overdue")

# At least one whole missed installment. The boundary: months_overdue == 0
# is current, == 1 is late.
MIN_MONTHS_OVERDUE = 1

TWO_PLACES = Decimal("0.01")


def is_late(status: str, months_overdue: int | None) -> bool:
    """Row-level twin of the report's SQL filter.

    Consistent BY CONSTRUCTION with the WHERE clause in the late-payers
    report (which compares against the same two constants above).
    """
    return status in LATE_SPONSORSHIP_STATUSES and (months_overdue or 0) >= MIN_MONTHS_OVERDUE


def months_elapsed(start: date, today: date, end: date | None = None) -> int:
    """Full months elapsed since ``start`` as of ``today``.

    Capped at the sponsorship's committed end date when one is set (the
    model records commitment as ``end_date``, not a duration in months). A
    start in the future — or a same-month start — yields 0.
    """
    effective = min(today, end) if end is not None else today
    if effective <= start:
        return 0
    months = (effective.year - start.year) * 12 + (effective.month - start.month)
    if effective.day < start.day:
        months -= 1
    return max(months, 0)


def installments_due(payments_count: int | None, months_overdue: int | None) -> int:
    """Installments that should have been received by today.

    Derived from the worker-maintained counters — what was actually paid
    plus what the worker marked as missed — so it can never disagree with
    ``months_overdue`` (the report's "months behind" column).
    """
    return (payments_count or 0) + (months_overdue or 0)


def amount_outstanding(monthly_amount: Decimal, months_overdue: int | None) -> Decimal:
    """Missed installments valued in the sponsorship's own currency."""
    return (monthly_amount * (months_overdue or 0)).quantize(TWO_PLACES)


def outstanding_in_default_currency(
    monthly_amount: Decimal,
    months_overdue: int | None,
    *,
    currency: str,
    default_currency: str,
    exchange_rate: Decimal | None,
) -> Decimal | None:
    """The outstanding amount expressed in the organization's default currency.

    Same-currency sponsorships convert 1:1. For a foreign-currency
    sponsorship the caller supplies ``exchange_rate`` (units of default
    currency per unit of the sponsorship currency — the convention of
    ``payments.exchange_rate``); with no known rate the amount is
    unknowable and ``None`` is returned, never a fabricated figure.
    """
    base = amount_outstanding(monthly_amount, months_overdue)
    if currency.upper() == default_currency.upper():
        return base
    if exchange_rate is None:
        return None
    return (base * exchange_rate).quantize(TWO_PLACES)
