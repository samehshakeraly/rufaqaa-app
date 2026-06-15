"""Unit tests for the fail-closed MyFatoorah webhook signature check.

Pure unit tests: no database, no app client, no fixtures beyond pytest's
built-in ``monkeypatch``. They drive ``_verify_myfatoorah_signature``
directly across the full behaviour matrix defined in its docstring.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.v1.webhooks import _sign_payload, _verify_myfatoorah_signature
from app.core.config import settings

_BODY = b'{"Data": {"InvoiceId": 123, "InvoiceStatus": "Paid"}}'
_SECRET = "test-webhook-secret"


def _configure(monkeypatch: pytest.MonkeyPatch, *, environment: str, secret: str) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", environment)
    monkeypatch.setattr(settings, "MYFATOORAH_WEBHOOK_SECRET", secret)


def test_secret_configured_missing_signature_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 1: secret set, no signature header -> 401."""
    _configure(monkeypatch, environment="production", secret=_SECRET)
    with pytest.raises(HTTPException) as exc:
        _verify_myfatoorah_signature(_BODY, None)
    assert exc.value.status_code == 401


def test_secret_configured_valid_signature_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 2: secret set, valid HMAC-SHA256 over the raw body -> pass."""
    _configure(monkeypatch, environment="production", secret=_SECRET)
    valid_signature = _sign_payload(_SECRET, _BODY)
    # No exception (returns None) == accepted.
    assert _verify_myfatoorah_signature(_BODY, valid_signature) is None


def test_secret_configured_invalid_signature_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 3: secret set, wrong signature -> 401."""
    _configure(monkeypatch, environment="production", secret=_SECRET)
    with pytest.raises(HTTPException) as exc:
        _verify_myfatoorah_signature(_BODY, "deadbeef")
    assert exc.value.status_code == 401


def test_empty_secret_non_development_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 4: secret empty outside development -> 503, fail closed."""
    _configure(monkeypatch, environment="production", secret="")
    with pytest.raises(HTTPException) as exc:
        _verify_myfatoorah_signature(_BODY, None)
    assert exc.value.status_code == 503
    assert exc.value.detail == "Webhook secret not configured"


def test_empty_secret_development_allows(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 5: secret empty in development -> allowed (local sandbox)."""
    _configure(monkeypatch, environment="development", secret="")
    # Allowed even with no signature header; must not raise.
    assert _verify_myfatoorah_signature(_BODY, None) is None


def test_raw_secret_not_accepted_as_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    """The removed static-secret fallback stays removed: sending the raw
    secret as the signature must be rejected (HMAC-only)."""
    _configure(monkeypatch, environment="production", secret=_SECRET)
    with pytest.raises(HTTPException) as exc:
        _verify_myfatoorah_signature(_BODY, _SECRET)
    assert exc.value.status_code == 401
