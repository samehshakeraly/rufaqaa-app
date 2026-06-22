"""Unit tests for the field-encryption utility (pure, no DB).

``encrypt_field`` / ``decrypt_field`` wrap Fernet keyed off
``settings.FIELD_ENCRYPTION_KEY``. These pin the round-trip, the
bytes-out/str-in contract, and that the ciphertext is both opaque and
non-deterministic.

``national_id_blind_index`` is the deterministic counterpart (HMAC-SHA256) that
backs the per-org unique index: these pin that it is deterministic, minimally
normalised, character-significant, and opaque.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import InvalidToken

from app.core.crypto import decrypt_field, encrypt_field, national_id_blind_index


def test_round_trip_recovers_plaintext() -> None:
    plaintext = "12345678901234"
    token = encrypt_field(plaintext)
    assert isinstance(token, bytes)
    assert decrypt_field(token) == plaintext


def test_ciphertext_is_opaque() -> None:
    """The token must not contain the plaintext in the clear."""
    plaintext = "29912345600789"
    token = encrypt_field(plaintext)
    assert plaintext.encode("utf-8") not in token


def test_encryption_is_non_deterministic() -> None:
    """Fernet embeds a random IV + timestamp, so the same input yields
    different tokens that both still decrypt back."""
    a = encrypt_field("same-value")
    b = encrypt_field("same-value")
    assert a != b
    assert decrypt_field(a) == decrypt_field(b) == "same-value"


def test_round_trip_handles_unicode() -> None:
    plaintext = "هوية-٢٠٢٤"
    assert decrypt_field(encrypt_field(plaintext)) == plaintext


def test_tampered_token_is_rejected() -> None:
    token = bytearray(encrypt_field("9990001112223"))
    token[-1] ^= 0x01  # flip a bit -> HMAC no longer verifies
    with pytest.raises(InvalidToken):
        decrypt_field(bytes(token))


# ── national_id blind index ─────────────────────────────────────────────


def test_blind_index_is_deterministic() -> None:
    """The same input always yields the same digest — the property that lets it
    back a UNIQUE index (unlike the per-write-randomised Fernet ciphertext)."""
    assert national_id_blind_index("29912345600789") == national_id_blind_index("29912345600789")


def test_blind_index_returns_raw_sha256_digest() -> None:
    """A raw 32-byte HMAC-SHA256 digest, matching the BYTEA column."""
    digest = national_id_blind_index("12345678901234")
    assert isinstance(digest, bytes)
    assert len(digest) == 32


def test_blind_index_minimal_normalization_ignores_whitespace() -> None:
    """Trim + internal-whitespace removal only: cosmetic spacing collapses, so
    "123 456", padded, and split variants all match the bare "123456"."""
    canonical = national_id_blind_index("123456")
    assert national_id_blind_index("123 456") == canonical
    assert national_id_blind_index("  123456  ") == canonical
    assert national_id_blind_index("12 34 56") == canonical


def test_blind_index_preserves_significant_characters() -> None:
    """Only whitespace is normalised — digits and punctuation stay significant,
    so genuinely different ids never collide."""
    assert national_id_blind_index("123456") != national_id_blind_index("1234560")
    assert national_id_blind_index("12-3456") != national_id_blind_index("123456")


def test_blind_index_is_opaque() -> None:
    """One-way: the plaintext does not appear in the digest."""
    plaintext = "29912345600789"
    assert plaintext.encode("utf-8") not in national_id_blind_index(plaintext)
