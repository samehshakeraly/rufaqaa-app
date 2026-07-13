"""Unit tests for ``app.core.reporting`` — the pure cadence rules.

No DB, no session. These lock the classification contract the house and
community reports consume:

* never reported -> overdue;
* the due day itself is still on_track (boundary INclusive);
* the grace period is due_soon up to and INcluding due + grace;
* one day past the grace period is overdue;
* ``due_status_cutoffs`` (the boundary definition the reports' SQL filters
  compare against) classifies every date exactly like ``report_due_status``;
* ``effective_cadence`` falls back to the platform default when the org
  has no cadence of its own.
"""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.constants import DEFAULT_REPORT_CADENCE_DAYS, REPORT_OVERDUE_GRACE_DAYS
from app.core.reporting import due_status_cutoffs, effective_cadence, report_due_status

TODAY = date(2026, 7, 10)


def test_never_reported_is_overdue() -> None:
    assert report_due_status(None, 90, TODAY) == "overdue"


def test_today_before_due_is_on_track() -> None:
    last = TODAY - timedelta(days=30)  # due in 60 days
    assert report_due_status(last, 90, TODAY) == "on_track"


def test_today_equals_due_is_on_track() -> None:
    last = TODAY - timedelta(days=90)  # due exactly today
    assert report_due_status(last, 90, TODAY) == "on_track"


def test_one_day_past_due_is_due_soon() -> None:
    last = TODAY - timedelta(days=91)
    assert report_due_status(last, 90, TODAY) == "due_soon"


def test_today_equals_due_plus_grace_is_due_soon() -> None:
    last = TODAY - timedelta(days=90 + REPORT_OVERDUE_GRACE_DAYS)
    assert report_due_status(last, 90, TODAY) == "due_soon"


def test_one_day_past_grace_is_overdue() -> None:
    last = TODAY - timedelta(days=90 + REPORT_OVERDUE_GRACE_DAYS + 1)
    assert report_due_status(last, 90, TODAY) == "overdue"


@pytest.mark.parametrize("cadence", [1, 30, 366])
def test_cadence_is_respected(cadence: int) -> None:
    on_due = TODAY - timedelta(days=cadence)
    past_grace = TODAY - timedelta(days=cadence + REPORT_OVERDUE_GRACE_DAYS + 1)
    assert report_due_status(on_due, cadence, TODAY) == "on_track"
    assert report_due_status(past_grace, cadence, TODAY) == "overdue"


def test_custom_grace_days_override() -> None:
    last = TODAY - timedelta(days=92)  # 2 days past a 90-day cadence
    assert report_due_status(last, 90, TODAY, grace_days=1) == "overdue"
    assert report_due_status(last, 90, TODAY, grace_days=2) == "due_soon"


def test_cutoffs_boundaries() -> None:
    on_track_floor, due_soon_floor = due_status_cutoffs(90, TODAY)
    assert on_track_floor == TODAY - timedelta(days=90)
    assert due_soon_floor == TODAY - timedelta(days=90 + REPORT_OVERDUE_GRACE_DAYS)


@pytest.mark.parametrize("cadence", [1, 30, 90, 366])
@pytest.mark.parametrize("grace", [0, 1, REPORT_OVERDUE_GRACE_DAYS])
def test_cutoffs_agree_with_report_due_status(cadence: int, grace: int) -> None:
    """The floor comparisons and the row-level classifier are the SAME rule:
    sweep every day from well inside the cadence to well past the grace
    period and both classifications must match — this is what lets the
    reports' SQL filters and report_due_status share one boundary."""
    on_track_floor, due_soon_floor = due_status_cutoffs(cadence, TODAY, grace_days=grace)
    for age in range(cadence + grace + 5):
        last = TODAY - timedelta(days=age)
        if last >= on_track_floor:
            by_floors = "on_track"
        elif last >= due_soon_floor:
            by_floors = "due_soon"
        else:
            by_floors = "overdue"
        assert by_floors == report_due_status(last, cadence, TODAY, grace_days=grace), (
            f"cadence={cadence} grace={grace} age={age}"
        )


def test_effective_cadence_prefers_org_value() -> None:
    org = SimpleNamespace(report_cadence_days=30)
    assert effective_cadence(org) == 30


def test_effective_cadence_falls_back_to_default() -> None:
    org = SimpleNamespace(report_cadence_days=None)
    assert effective_cadence(org) == DEFAULT_REPORT_CADENCE_DAYS
