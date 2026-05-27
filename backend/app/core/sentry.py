"""Sentry integration. No-op when SENTRY_DSN is empty (the default in
dev/test). Imported lazily so the dependency is optional at runtime."""

from __future__ import annotations

from app.core.config import settings


def init_sentry() -> bool:
    """Wire Sentry on app startup. Returns True if the SDK was
    initialized, False otherwise (allows the caller to log the choice)."""
    if not settings.SENTRY_DSN:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        # Library not installed — degrade gracefully so the import
        # doesn't break the app boot in environments that haven't
        # pinned the dep yet.
        return False

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=settings.SENTRY_RELEASE or None,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        # send_default_pii intentionally False — caller info (email,
        # IP) is not what we want in error reports for an orphan-data
        # platform.
        send_default_pii=False,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            SqlalchemyIntegration(),
            CeleryIntegration(),
        ],
    )
    return True
