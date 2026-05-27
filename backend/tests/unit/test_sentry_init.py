"""init_sentry behaves as a safe no-op when SENTRY_DSN is empty."""

from __future__ import annotations

from app.core import sentry as sentry_module
from app.core.config import settings


def test_init_sentry_noop_when_dsn_empty(monkeypatch) -> None:
    monkeypatch.setattr(settings, "SENTRY_DSN", "")
    assert sentry_module.init_sentry() is False


def test_init_sentry_returns_true_when_dsn_set(monkeypatch) -> None:
    # Use a syntactically-valid but unreachable DSN. sentry_sdk.init
    # does not perform a network call on construction.
    monkeypatch.setattr(
        settings,
        "SENTRY_DSN",
        "https://public@sentry.invalid/42",
    )
    assert sentry_module.init_sentry() is True
