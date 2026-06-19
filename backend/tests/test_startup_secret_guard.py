"""Unit tests for the fail-closed startup secret guard.

Pure unit tests: no database, no app client. Each case builds a
``Settings`` instance directly (constructor kwargs take priority over the
environment / ``.env``, so the assertions are deterministic) and drives
``assert_production_secrets`` across the behaviour described in its
docstring.
"""

from __future__ import annotations

from typing import Any, Literal

import pytest

from app.core import startup_checks
from app.core.config import Settings
from app.core.startup_checks import assert_production_secrets

# The well-known development defaults. A misconfigured boot must name
# these *fields* but must never echo any of these *values*.
_DEV_SECRET = "development_only_change_in_production"
# The development-default Fernet key (see config.FIELD_ENCRYPTION_KEY); guarded
# like the others — flagged outside development, value never echoed.
_DEV_FIELD_KEY = "XXyCXLqmy2OX2kkb3eml_J_ZnY7tma4cf4XhaIAK0C0="
_EXPECTED_FIELDS = (
    "SECRET_KEY",
    "JWT_SECRET_KEY",
    "FIELD_ENCRYPTION_KEY",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "MYFATOORAH_API_KEY",
    "MYFATOORAH_WEBHOOK_SECRET",
)
_DEV_SECRET_VALUES = (
    _DEV_SECRET,
    _DEV_FIELD_KEY,
    "rufaqaa_admin",
    "rufaqaa_dev_secret_change_me",
)


def _make_settings(
    *,
    environment: Literal["development", "staging", "production"],
    secret_key: str = _DEV_SECRET,
    jwt_secret_key: str = _DEV_SECRET,
    field_encryption_key: str = _DEV_FIELD_KEY,
    s3_access_key: str = "rufaqaa_admin",
    s3_secret_key: str = "rufaqaa_dev_secret_change_me",
    myfatoorah_api_key: str = "",
    myfatoorah_webhook_secret: str = "",
) -> Settings:
    """Build a Settings instance. Defaults reproduce the dev secrets, so
    a caller that only sets ``environment`` gets the fully-misconfigured
    case."""
    return Settings(
        ENVIRONMENT=environment,
        SECRET_KEY=secret_key,
        JWT_SECRET_KEY=jwt_secret_key,
        FIELD_ENCRYPTION_KEY=field_encryption_key,
        S3_ACCESS_KEY=s3_access_key,
        S3_SECRET_KEY=s3_secret_key,
        MYFATOORAH_API_KEY=myfatoorah_api_key,
        MYFATOORAH_WEBHOOK_SECRET=myfatoorah_webhook_secret,
    )


def _secure_settings(
    environment: Literal["development", "staging", "production"],
) -> Settings:
    """All production-critical secrets overridden to safe, non-default
    values."""
    return _make_settings(
        environment=environment,
        secret_key="x" * 64,
        jwt_secret_key="y" * 64,
        field_encryption_key="prod-field-encryption-key-value",
        s3_access_key="prod-access-key",
        s3_secret_key="prod-secret-key-value",
        myfatoorah_api_key="mf-live-api-key",
        myfatoorah_webhook_secret="mf-live-webhook-secret",
    )


def test_production_defaults_raise_naming_fields_without_values() -> None:
    """Production + default/empty secrets -> RuntimeError naming every
    offending field and leaking no secret value."""
    with pytest.raises(RuntimeError) as exc:
        assert_production_secrets(_make_settings(environment="production"))

    message = str(exc.value)
    for field in _EXPECTED_FIELDS:
        assert field in message, f"{field} should be named in the error"
    for value in _DEV_SECRET_VALUES:
        assert value not in message, "the error must not echo a secret value"


def test_staging_defaults_raise_like_production() -> None:
    """Staging behaves exactly like production: defaults -> RuntimeError."""
    with pytest.raises(RuntimeError) as exc:
        assert_production_secrets(_make_settings(environment="staging"))

    message = str(exc.value)
    for field in _EXPECTED_FIELDS:
        assert field in message
    for value in _DEV_SECRET_VALUES:
        assert value not in message


def test_production_all_overridden_returns_none() -> None:
    """Production + every secret overridden -> passes (returns None)."""
    assert assert_production_secrets(_secure_settings("production")) is None


def test_development_defaults_is_noop() -> None:
    """Development + defaults -> no-op (returns None), never raises."""
    assert assert_production_secrets(_make_settings(environment="development")) is None


def test_partial_misconfiguration_names_only_offending_fields() -> None:
    """Only the still-default fields are reported; correctly set ones are
    omitted."""
    settings = _make_settings(
        environment="production",
        secret_key="x" * 64,
        jwt_secret_key="y" * 64,
        field_encryption_key="prod-field-encryption-key-value",
        s3_access_key="prod-access-key",
        s3_secret_key="prod-secret-key-value",
        # The MyFatoorah pair is left empty -> the only offenders.
    )
    with pytest.raises(RuntimeError) as exc:
        assert_production_secrets(settings)

    message = str(exc.value)
    assert "MYFATOORAH_API_KEY" in message
    assert "MYFATOORAH_WEBHOOK_SECRET" in message
    assert "SECRET_KEY" not in message
    assert "S3_ACCESS_KEY" not in message


def test_misconfiguration_logs_one_critical_line_names_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A misconfigured boot emits exactly one CRITICAL line carrying the
    environment and field names — and no secret value."""

    class _RecordingLogger:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, Any]]] = []

        def critical(self, event: str, **kwargs: Any) -> None:
            self.calls.append((event, kwargs))

    recorder = _RecordingLogger()
    monkeypatch.setattr(startup_checks, "_log", recorder)

    with pytest.raises(RuntimeError):
        assert_production_secrets(_make_settings(environment="production"))

    assert len(recorder.calls) == 1
    event, kwargs = recorder.calls[0]
    assert event == "production_secrets_misconfigured"
    assert kwargs["environment"] == "production"
    assert set(kwargs["fields"]) == set(_EXPECTED_FIELDS)
    blob = repr(kwargs)
    for value in _DEV_SECRET_VALUES:
        assert value not in blob
