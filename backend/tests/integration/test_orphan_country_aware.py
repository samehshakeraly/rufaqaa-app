"""Country-aware orphan creation — conditional national_id validation +
country_specific persistence, exercised through BOTH create paths (PR-3b).

``create_orphan_record`` is the shared chokepoint for the staff
``POST /orphans`` and the guardian self-service ``POST /guardian/me/orphans``,
so the national_id rule is enforced identically on both. The rule is resolved
from the country's ``country_requirements`` row (seeded in migration 0015):

* EG (documented) — national_id REQUIRED, exactly 14 digits.
* PS (conflict)   — national_id NOT required; length 9 when present, no regex.
* KW (valid, unconfigured) — permissive baseline: any/empty national_id accepted.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations + the 0015 seed applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise
they skip. They reuse the guardian-provisioning helpers from
``test_guardian_self`` so the self-service path is set up end-to-end.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient, Response

from app.core.crypto import decrypt_field
from app.core.database import make_session
from app.models.orphan import Orphan
from tests.integration.test_guardian_self import (
    _create_family_and_guardian,
    _link_family_to_partner,
    _seed_partner_id,
)

# (nationality, national_id, expected_status) — the identical matrix runs through
# both create paths so the staff and guardian routes stay in lock-step.
_NATIONAL_ID_MATRIX: list[tuple[str, str | None, int]] = [
    # EG (documented): required, exactly 14 digits.
    ("EG", None, 422),  # required & missing → rejected
    ("EG", "123", 422),  # present but wrong length (and wrong format)
    ("EG", "12345678901234", 201),  # 14 digits → created
    # PS (conflict): not required; length 9 when present, no regex.
    ("PS", None, 201),  # missing & not required → created
    ("PS", "123456789", 201),  # 9 digits → created
    ("PS", "12345678", 422),  # 8 digits → length mismatch
    # KW (valid but unconfigured): permissive baseline accepts anything.
    ("KW", None, 201),
    ("KW", "anything-goes", 201),
]


def _identity_payload(**overrides: Any) -> dict[str, Any]:
    """A minimal, unique orphan-identity payload. Unique names dodge the
    no-duplicate 409 so each matrix row is independent."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, Any] = {
        "first_name": f"بلد-{suffix}",
        "family_name": "اختبار",
        "date_of_birth": "2015-06-01",
        "gender": "M",
        "father_name": f"أب-{suffix}",
    }
    payload.update(overrides)
    return payload


def _with_country_fields(
    payload: dict[str, Any],
    national_id: str | None,
    country_specific: dict[str, Any] | None,
) -> dict[str, Any]:
    # Only attach the keys when supplied so we also exercise the "field omitted"
    # path (which must fall back to None / the empty-object default).
    if national_id is not None:
        payload["national_id"] = national_id
    if country_specific is not None:
        payload["country_specific"] = country_specific
    return payload


async def _staff_create(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    *,
    nationality: str,
    national_id: str | None = None,
    country_specific: dict[str, Any] | None = None,
) -> Response:
    payload = _identity_payload(partner_organization_id=partner_id, nationality=nationality)
    payload = _with_country_fields(payload, national_id, country_specific)
    return await api.post("/api/v1/orphans", json=payload, headers=headers)


async def _guardian_create(
    api: AsyncClient,
    headers: dict[str, str],
    *,
    nationality: str,
    national_id: str | None = None,
    country_specific: dict[str, Any] | None = None,
) -> Response:
    payload = _identity_payload(nationality=nationality)
    payload = _with_country_fields(payload, national_id, country_specific)
    return await api.post("/api/v1/guardian/me/orphans", json=payload, headers=headers)


# ── Staff path (POST /orphans) ──────────────────────────────────────────


async def test_staff_create_national_id_matrix(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The national_id rule is enforced on the staff create path for every
    matrix row (EG required/shaped, PS optional/length-checked, KW baseline)."""
    partner_id = await _seed_partner_id()
    failures: list[str] = []
    for nationality, national_id, expected in _NATIONAL_ID_MATRIX:
        r = await _staff_create(
            api, auth_headers, partner_id, nationality=nationality, national_id=national_id
        )
        if r.status_code != expected:
            failures.append(
                f"{nationality}/{national_id!r}: expected {expected}, got {r.status_code} ({r.text})"
            )
    assert not failures, "\n".join(failures)


async def test_staff_create_encrypts_national_id_and_persists_country_specific(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A staff create encrypts national_id at rest — national_id_encrypted holds
    the decryptable token (the plaintext column was dropped in 0020) — and
    round-trips the country_specific bag verbatim. national_id is write-only: it
    is never echoed back in the response."""
    partner_id = await _seed_partner_id()
    bag = {"housing": "rented", "siblings": 3, "guardian_note": "ملاحظة", "nested": {"k": [1, 2]}}
    r = await _staff_create(
        api,
        auth_headers,
        partner_id,
        nationality="EG",
        national_id="12345678901234",
        country_specific=bag,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "national_id" not in body  # write-only — never serialised on read

    orphan_id = body["id"]
    async with make_session() as db:
        orphan = await db.get(Orphan, uuid.UUID(orphan_id))
        assert orphan is not None
        assert orphan.country_specific == bag  # JSONB bag round-trips intact
        assert orphan.national_id_encrypted is not None  # ciphertext persisted
        # The stored token decrypts back to exactly the submitted id.
        assert decrypt_field(orphan.national_id_encrypted) == "12345678901234"


async def test_staff_create_country_specific_defaults_to_empty_object(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Omitting both fields persists the empty-object default for
    country_specific (never NULL) and no national_id ciphertext."""
    partner_id = await _seed_partner_id()
    r = await _staff_create(api, auth_headers, partner_id, nationality="KW")
    assert r.status_code == 201, r.text
    async with make_session() as db:
        orphan = await db.get(Orphan, uuid.UUID(r.json()["id"]))
    assert orphan is not None
    assert orphan.country_specific == {}
    assert orphan.national_id_encrypted is None  # omitted id → no ciphertext stored


# ── Guardian self-service path (POST /guardian/me/orphans) ──────────────


async def test_guardian_create_national_id_matrix(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The SAME matrix holds on the guardian self-service path — the shared
    chokepoint means staff and guardian enforce national_id identically."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    failures: list[str] = []
    for nationality, national_id, expected in _NATIONAL_ID_MATRIX:
        r = await _guardian_create(api, headers, nationality=nationality, national_id=national_id)
        if r.status_code != expected:
            failures.append(
                f"{nationality}/{national_id!r}: expected {expected}, got {r.status_code} ({r.text})"
            )
    assert not failures, "\n".join(failures)


async def test_guardian_create_encrypts_national_id_and_persists_country_specific(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The country_specific bag persists and national_id is encrypted at rest on
    the guardian self-service path too (shared create_orphan_record chokepoint):
    national_id_encrypted holds the decryptable token (the plaintext column was
    dropped in 0020)."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)

    bag = {"shelter": "tent", "displaced": True, "members": 5}
    r = await _guardian_create(
        api, headers, nationality="PS", national_id="123456789", country_specific=bag
    )
    assert r.status_code == 201, r.text
    async with make_session() as db:
        orphan = await db.get(Orphan, uuid.UUID(r.json()["id"]))
    assert orphan is not None
    assert orphan.country_specific == bag
    assert orphan.national_id_encrypted is not None  # ciphertext persisted
    assert decrypt_field(orphan.national_id_encrypted) == "123456789"
