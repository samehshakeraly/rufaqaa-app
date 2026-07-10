"""Unit tests for ``app.core.reporting`` — the pure cadence rules.

No DB, no session. These lock the classification contract the house and
community reports will consume when they migrate off the fixed window:

* never reported -> overdue;
* the due day itself is still on_track (boundary INclusive);
* the grace period is due_soon up to and INcluding due + grace;
* one day past the grace period is overdue;
* ``effective_cadence`` falls back to the platform default when the org
  has no cadence of its own.
"""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.constants import DEFAULT_REPORT_CADENCE_DAYS, REPORT_OVERDUE_GRACE_DAYS
from app.core.reporting import effective_cadence, report_due_status

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


def test_effective_cadence_prefers_org_value() -> None:
    org = SimpleNamespace(report_cadence_days=30)
    assert effective_cadence(org) == 30


def test_effective_cadence_falls_back_to_default() -> None:
    org = SimpleNamespace(report_cadence_days=None)
    assert effective_cadence(org) == DEFAULT_REPORT_CADENCE_DAYS
