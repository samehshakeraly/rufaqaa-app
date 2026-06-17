"""Production secrets startup guard (app/core/config.py).

These tests pin the fail-closed behaviour: outside development the app must
refuse to construct ``Settings`` while any security secret is empty or still
set to its well-known insecure default. A default JWT signing key in
production is catastrophic — anyone who knows it can forge valid tokens — so
the failure must happen loudly at startup, never silently at runtime.

Settings are built directly with explicit kwargs (and ``_env_file=None`` to
ignore any local ``.env``), so the suite is hermetic and DB-free: no database,
Redis, or env file is touched.
"""

from __future__ import annotations

import re

import pytest
from pydantic import ValidationError

from app.core.config import Settings

# The shared insecure default for SECRET_KEY / JWT_SECRET_KEY, mirrored from
# config.py. Kept as a literal here so the test fails if the default ever
# changes without the guard being revisited.
INSECURE_DEFAULT = "development_only_change_in_production"

# Distinct, obviously-fake production values (not real secrets).
REAL_SECRETS = {
    "SECRET_KEY": "test-app-secret-not-the-default-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "JWT_SECRET_KEY": "test-jwt-secret-not-the-default-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "MYFATOORAH_WEBHOOK_SECRET": "test-webhook-secret-cccccccccccccccccccccccccccccccc",
}


@pytest.mark.parametrize("environment", ["production", "staging"])
def test_non_dev_with_insecure_defaults_raises(environment: str) -> None:
    """Any non-development environment must reject the default/empty trio."""
    with pytest.raises((ValidationError, ValueError)) as excinfo:
        Settings(
            ENVIRONMENT=environment,
            SECRET_KEY=INSECURE_DEFAULT,
            JWT_SECRET_KEY=INSECURE_DEFAULT,
            MYFATOORAH_WEBHOOK_SECRET="",
            _env_file=None,
        )

    # The message must name every offending secret so operators know what to fix.
    message = str(excinfo.value)
    assert "SECRET_KEY" in message
    assert "JWT_SECRET_KEY" in message
    assert "MYFATOORAH_WEBHOOK_SECRET" in message


def test_production_with_real_secrets_ok() -> None:
    """All three real secrets in production: constructs fine."""
    settings = Settings(ENVIRONMENT="production", _env_file=None, **REAL_SECRETS)

    assert settings.ENVIRONMENT == "production"
    assert settings.SECRET_KEY == REAL_SECRETS["SECRET_KEY"]
    assert settings.JWT_SECRET_KEY == REAL_SECRETS["JWT_SECRET_KEY"]
    assert settings.MYFATOORAH_WEBHOOK_SECRET == REAL_SECRETS["MYFATOORAH_WEBHOOK_SECRET"]


def test_development_with_defaults_ok() -> None:
    """Development keeps the defaults for zero-config local runs — no raise."""
    settings = Settings(
        ENVIRONMENT="development",
        SECRET_KEY=INSECURE_DEFAULT,
        JWT_SECRET_KEY=INSECURE_DEFAULT,
        MYFATOORAH_WEBHOOK_SECRET="",
        _env_file=None,
    )

    assert settings.ENVIRONMENT == "development"
    assert settings.SECRET_KEY == INSECURE_DEFAULT
    assert settings.MYFATOORAH_WEBHOOK_SECRET == ""


@pytest.mark.parametrize(
    "offending",
    ["SECRET_KEY", "JWT_SECRET_KEY", "MYFATOORAH_WEBHOOK_SECRET"],
)
def test_production_names_each_unset_secret(offending: str) -> None:
    """With only one secret left unset/default, the error names exactly that one."""
    kwargs: dict[str, str] = {**REAL_SECRETS}
    # SECRET_KEY / JWT_SECRET_KEY fail on the insecure default; the webhook
    # secret fails on empty (its only "default").
    kwargs[offending] = "" if offending == "MYFATOORAH_WEBHOOK_SECRET" else INSECURE_DEFAULT

    with pytest.raises((ValidationError, ValueError)) as excinfo:
        Settings(ENVIRONMENT="production", _env_file=None, **kwargs)

    message = str(excinfo.value)
    # Word-boundary match: "SECRET_KEY" is a substring of "JWT_SECRET_KEY",
    # so a plain `in` check would conflate the two.
    assert re.search(rf"\b{re.escape(offending)}\b", message)
    # The two correctly-set secrets must NOT be flagged.
    for other in REAL_SECRETS:
        if other != offending:
            assert not re.search(rf"\b{re.escape(other)}\b", message)
