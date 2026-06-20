"""Field-level encryption for PII stored at rest (Fernet).

Symmetric authenticated encryption (AES-128-CBC + HMAC, via ``cryptography``'s
Fernet) keyed off :data:`app.core.config.settings.FIELD_ENCRYPTION_KEY`. Used
to encrypt sensitive columns — currently ``national_id`` on guardians and
orphans — so their plaintext is never persisted; the ciphertext token lives in
the matching ``*_encrypted`` BYTEA column.

A single key is used. Key rotation (multi-key ``MultiFernet``) is intentionally
out of scope. The key is validated at startup by the secrets guard
(:func:`app.core.startup_checks.assert_production_secrets`), so an unset or
development-default key fails the boot outside ``development``.
"""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet

from app.core.config import settings


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    """Build (and cache) the Fernet cipher from the configured key.

    Raises ``ValueError`` if ``FIELD_ENCRYPTION_KEY`` is not a valid Fernet
    key — surfacing a misconfiguration loudly on first use.
    """
    return Fernet(settings.FIELD_ENCRYPTION_KEY.encode("utf-8"))


def encrypt_field(value: str) -> bytes:
    """Encrypt a plaintext string, returning the Fernet token as bytes.

    The token is non-deterministic (Fernet embeds a random IV and timestamp),
    so encrypting the same value twice yields different ciphertext.
    """
    return _fernet().encrypt(value.encode("utf-8"))


def decrypt_field(blob: bytes) -> str:
    """Decrypt a token produced by :func:`encrypt_field` back to plaintext.

    Raises ``cryptography.fernet.InvalidToken`` if ``blob`` was not produced by
    this key (tampered, truncated, or encrypted under a different key).
    """
    return _fernet().decrypt(blob).decode("utf-8")
