from uuid import uuid4

from app.core.security import (
    create_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_password_round_trip() -> None:
    h = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", h)
    assert not verify_password("wrong password", h)


def test_token_round_trip() -> None:
    user_id = uuid4()
    org_id = uuid4()
    token = create_token(user_id, "access", org_id=org_id, role="org_admin")
    payload = decode_token(token)
    assert payload["sub"] == str(user_id)
    assert payload["org"] == str(org_id)
    assert payload["role"] == "org_admin"
    assert payload["type"] == "access"
