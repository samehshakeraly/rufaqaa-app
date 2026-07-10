"""Pure reporting-cadence rules — no DB, no session, fully unit-testable.

``report_due_status`` is the single source of truth for classifying a
child's reporting state against an organization's cadence. The house and
community reports will consume it when they migrate off the fixed
``REPORT_WINDOW_DAYS`` window.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Protocol

from app.core.constants import DEFAULT_REPORT_CADENCE_DAYS, REPORT_OVERDUE_GRACE_DAYS

ReportDueStatus = Literal["on_track", "due_soon", "overdue"]


class _HasReportCadence(Protocol):
    """Anything carrying an optional per-org cadence (the Organization model)."""

    report_cadence_days: int | None


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
    due = last_period_end + timedelta(days=cadence_days)
    if today <= due:
        return "on_track"
    if today <= due + timedelta(days=grace_days):
        return "due_soon"
    return "overdue"


def effective_cadence(org: _HasReportCadence) -> int:
    """The org's cadence, falling back to the platform default when unset."""
    return org.report_cadence_days or DEFAULT_REPORT_CADENCE_DAYS
