"""Fail-closed startup secret guard.

Outside ``development`` the application must never boot with a
production-critical secret left empty or still set to the well-known
development default that ships in the repo. ``assert_production_secrets``
runs from the FastAPI ``lifespan`` before the app serves any traffic: if
any guarded field is misconfigured it logs a single CRITICAL line naming
the offending fields and raises ``RuntimeError``, aborting boot.

This complements the request-time fail-closed check in
``app.api.v1.webhooks`` (which rejects unsigned webhooks when the secret
is absent) by catching the misconfiguration at startup rather than on the
first inbound request.

Only field *names* are ever logged or surfaced in the raised error —
never a secret value.
"""

from __future__ import annotations

import structlog

from app.core.config import Settings

_log = structlog.get_logger("rufaqaa.startup")

# Production-critical secrets, each paired with the development-only
# default it ships with. A field is misconfigured outside ``development``
# when its value is empty OR still equal to this default. The empty
# string covers the secrets whose default is already "" (the MyFatoorah
# pair). Append new production-critical secrets here as they are added.
_REQUIRED_SECRETS: tuple[tuple[str, str], ...] = (
    ("SECRET_KEY", "development_only_change_in_production"),
    ("JWT_SECRET_KEY", "development_only_change_in_production"),
    ("S3_ACCESS_KEY", "rufaqaa_admin"),
    ("S3_SECRET_KEY", "rufaqaa_dev_secret_change_me"),
    ("MYFATOORAH_API_KEY", ""),
    ("MYFATOORAH_WEBHOOK_SECRET", ""),
)


def assert_production_secrets(settings: Settings) -> None:
    """Refuse to boot when production-critical secrets are misconfigured.

    No-op in ``development``. In ``staging`` and ``production`` every
    field in ``_REQUIRED_SECRETS`` must be a non-empty value that differs
    from its development default; otherwise this logs one CRITICAL line
    (field names + environment only — never a secret value) and raises
    ``RuntimeError`` naming the offending fields. Fail-closed: any doubt
    aborts the boot.
    """
    if settings.ENVIRONMENT == "development":
        return

    misconfigured: list[str] = []
    for name, dev_default in _REQUIRED_SECRETS:
        value = getattr(settings, name)
        if value == "" or value == dev_default:
            misconfigured.append(name)

    if not misconfigured:
        return

    _log.critical(
        "production_secrets_misconfigured",
        environment=settings.ENVIRONMENT,
        fields=misconfigured,
    )
    raise RuntimeError(
        f"Refusing to boot in {settings.ENVIRONMENT}: production-critical "
        "secret(s) are unset or still set to their development default: "
        f"{', '.join(misconfigured)}. Provide real values via environment "
        "variables before deploying."
    )
