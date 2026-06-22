"""Field-level encryption for PII stored at rest (Fernet) + blind indexing.

Symmetric authenticated encryption (AES-128-CBC + HMAC, via ``cryptography``'s
Fernet) keyed off :data:`app.core.config.settings.FIELD_ENCRYPTION_KEY`. Used
to encrypt sensitive columns — currently ``national_id`` on guardians and
orphans — so their plaintext is never persisted; the ciphertext token lives in
the matching ``*_encrypted`` BYTEA column.

Fernet ciphertext is deliberately *non-deterministic* (random IV + timestamp),
which is great for confidentiality but means you cannot test two ciphertexts
for equality to spot a duplicate. :func:`national_id_blind_index` solves that:
a deterministic keyed HMAC over the normalized plaintext that backs a UNIQUE
index, so the same id is detectable even though its ciphertext changes per
write. Its key is derived from the SAME secret as Fernet.

A single key is used. Key rotation (multi-key ``MultiFernet``) is intentionally
out of scope. The key is validated at startup by the secrets guard
(:func:`app.core.startup_checks.assert_production_secrets`), so an unset or
development-default key fails the boot outside ``development``.
"""

from __future__ import annotations

import hashlib
import hmac
from functools import lru_cache

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

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


@lru_cache(maxsize=1)
def _blind_index_key() -> bytes:
    """Derive (and cache) the HMAC key used for blind indexing.

    Derived from the SAME secret as Fernet (``FIELD_ENCRYPTION_KEY``) via
    HKDF-SHA256 with a fixed, versioned ``info`` label, so the blind-index key
    is cryptographically separated from the encryption use of that secret
    (domain separation) — the two never share a derived key.

    Like the Fernet key, this key MUST stay stable: because it is derived from
    ``FIELD_ENCRYPTION_KEY``, rotating that secret silently changes every blind
    index, so previously stored indexes would no longer match freshly computed
    ones and duplicate detection would break — exactly as rotating it
    invalidates every Fernet ciphertext. Treat it as immutable.
    """
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"rufaqaa.national_id.blind_index.v1",
    ).derive(settings.FIELD_ENCRYPTION_KEY.encode("utf-8"))


def _normalize_national_id(value: str) -> str:
    """Minimal, stable normalization for blind indexing.

    Trims and removes *all* whitespace (leading, trailing, and internal) so
    cosmetic spacing — e.g. ``"123 456"`` vs ``"123456"`` — maps to one index.
    Nothing else is touched: digits, letters and significant punctuation (a
    leading zero, a hyphen, …) are preserved, so genuinely distinct ids never
    collide. ``str.split()`` collapses any whitespace run and drops the empties.
    """
    return "".join(value.split())


def national_id_blind_index(value: str) -> bytes:
    """Deterministic HMAC-SHA256 blind index of a national id.

    The same (normalized) input always yields the same raw 32-byte digest, so it
    can back a UNIQUE index that catches a duplicate national id even though the
    Fernet ciphertext from :func:`encrypt_field` is randomised on every write.

    Returned as raw bytes to match the ``BYTEA`` column. It is one-way (the
    plaintext cannot be recovered from it) and, like the encrypted value itself,
    is WRITE-ONLY — never serialise it in any read schema.
    """
    normalized = _normalize_national_id(value)
    return hmac.new(_blind_index_key(), normalized.encode("utf-8"), hashlib.sha256).digest()
