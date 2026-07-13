"""Pure reporting-cadence rules — no DB, no session, fully unit-testable.

``due_status_cutoffs`` is the single boundary definition for classifying a
child's reporting state against an organization's cadence: the row-level
``report_due_status`` and the reports' set-based SQL filters (the house and
community reports) both derive from it, so the two can never drift.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Protocol

from app.core.constants import DEFAULT_REPORT_CADENCE_DAYS, REPORT_OVERDUE_GRACE_DAYS

ReportDueStatus = Literal["on_track", "due_soon", "overdue"]


class _HasReportCadence(Protocol):
    """Anything carrying an optional per-org cadence (the Organization model)."""

    report_cadence_days: int | None


def due_status_cutoffs(
    cadence_days: int,
    today: date,
    *,
    grace_days: int = REPORT_OVERDUE_GRACE_DAYS,
) -> tuple[date, date]:
    """Return ``(on_track_floor, due_soon_floor)`` for a child's last
    non-draft ``period_end`` ``e``:

    - ``e >= on_track_floor`` -> "on_track"
    - ``due_soon_floor <= e < on_track_floor`` -> "due_soon"
    - ``e < due_soon_floor`` or ``e is None`` -> "overdue"

    Consistent BY CONSTRUCTION with :func:`report_due_status` (which derives
    from these floors) — the reports' SQL filters compare against the same
    two dates, so the row-level and set-based classifications never drift.
    """
    on_track_floor = today - timedelta(days=cadence_days)
    due_soon_floor = on_track_floor - timedelta(days=grace_days)
    return on_track_floor, due_soon_floor


def report_due_status(
    last_period_end: date | None,
    cadence_days: int,
    today: date,
    *,
    grace_days: int = REPORT_OVERDUE_GRACE_DAYS,
) -> ReportDueStatus:
    """Classify a child's reporting state against the org's cadence.

    - never reported (``last_period_end is None``) -> "overdue"
    - on or before the due date -> "on_track" (the due day itself is on_track)
    - within ``grace_days`` after the due date -> "due_soon"
    - past the grace period -> "overdue"
    """
    if last_period_end is None:
        return "overdue"
    on_track_floor, due_soon_floor = due_status_cutoffs(cadence_days, today, grace_days=grace_days)
    if last_period_end >= on_track_floor:
        return "on_track"
    if last_period_end >= due_soon_floor:
        return "due_soon"
    return "overdue"


def effective_cadence(org: _HasReportCadence) -> int:
    """The org's cadence, falling back to the platform default when unset."""
    return org.report_cadence_days or DEFAULT_REPORT_CADENCE_DAYS
