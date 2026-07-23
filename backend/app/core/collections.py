"""Pure late-payment (collections) rules — no DB, no session, fully unit-testable.

The sponsorship model already carries the authoritative next-due field
(``sponsorships.next_payment_date``, set on create and consumed by the daily
``mark_overdue_sponsorships`` worker), so "late" is derived from it rather
than re-counted from payment rows.

``late_payment_cutoff`` is the single boundary definition: the row-level
``is_late_payer`` and the report's SQL filter both compare
``next_payment_date`` against the same cutoff date, so the two can never
drift (mirrors ``app.core.reporting.due_status_cutoffs``).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.core.constants import LATE_PAYMENT_GRACE_DAYS

# Statuses a late payer can be in: still 'active' (worker hasn't flipped it
# yet) or already flipped to 'overdue' by the daily worker. paused /
# cancelled / completed sponsorships are never chased.
LATE_ELIGIBLE_STATUSES: tuple[str, ...] = ("active", "overdue")


def late_payment_cutoff(today: date, *, grace_days: int = LATE_PAYMENT_GRACE_DAYS) -> date:
    """A sponsorship whose ``next_payment_date`` is strictly before this date
    is late; on or after it, the sponsor is still within the grace period.

    The report's SQL predicate compares against this same date
    (``next_payment_date < late_payment_cutoff(today)``) — keep both in sync
    by construction, never by copy.
    """
    return today - timedelta(days=grace_days)


def is_late_payer(
    status: str,
    next_payment_date: date | None,
    today: date,
    *,
    grace_days: int = LATE_PAYMENT_GRACE_DAYS,
) -> bool:
    """Row-level twin of the report's SQL filter."""
    return (
        status in LATE_ELIGIBLE_STATUSES
        and next_payment_date is not None
        and next_payment_date < late_payment_cutoff(today, grace_days=grace_days)
    )


def months_elapsed(start: date, today: date) -> int:
    """Full calendar months from ``start`` to ``today`` (floor 0).

    The monthly anniversary day is clamped at 28, matching how
    ``next_payment_date`` is scheduled (see ``_next_monthly`` in the
    sponsorships router), so a Jan 31 start still completes its first month
    on Feb 28.
    """
    if today <= start:
        return 0
    months = (today.year - start.year) * 12 + (today.month - start.month)
    if today.day < min(start.day, 28):
        months -= 1
    return max(months, 0)


def installments_due(start: date, end: date | None, today: date) -> int:
    """Monthly installments due by ``today``: full months elapsed since the
    sponsorship start, capped at the committed term when an end date exists.
    """
    due = months_elapsed(start, today)
    if end is not None:
        due = min(due, months_elapsed(start, end))
    return due


def months_behind(next_payment_date: date, today: date) -> int:
    """Missed monthly installments once a sponsor is late: the installment
    due on ``next_payment_date`` itself plus one per full month since.

    Grace only gates *whether* a sponsor is late (``is_late_payer``); once
    late, arrears are counted from the due date itself.
    """
    if next_payment_date > today:
        return 0
    return 1 + months_elapsed(next_payment_date, today)


def amount_outstanding(monthly_amount: Decimal, behind: int) -> Decimal:
    """Arrears for ``behind`` missed installments, in the sponsorship's own
    currency — FX conversion to the org default is the caller's concern.
    """
    return (monthly_amount * behind).quantize(Decimal("0.01"))
