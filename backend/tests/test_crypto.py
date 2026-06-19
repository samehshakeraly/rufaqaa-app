"""Unit tests for the field-encryption utility (pure, no DB).

``encrypt_field`` / ``decrypt_field`` wrap Fernet keyed off
``settings.FIELD_ENCRYPTION_KEY``. These pin the round-trip, the
bytes-out/str-in contract, and that the ciphertext is both opaque and
non-deterministic.
"""

from __future__ import annotations

import pytest
from cryptography.fernet import InvalidToken

from app.core.crypto import decrypt_field, encrypt_field


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
