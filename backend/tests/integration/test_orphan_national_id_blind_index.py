"""Per-organization uniqueness of orphan national_id via the blind index (PR A).

national_id is Fernet-encrypted at rest, and Fernet is randomised per write — so
two encryptions of the SAME id produce DIFFERENT ciphertext. A naive unique
index on the ciphertext would therefore NEVER catch a duplicate. The
deterministic HMAC blind index (``app.core.crypto.national_id_blind_index``)
does: it backs the partial-unique ``uq_orphans_national_id_per_org`` so the same
id can't be registered twice within one organization.

These exercise the rule end-to-end through the API:

* a duplicate national_id in the same org → a clean 409 (and the two ciphertexts
  really do differ, proving the *blind index*, not the ciphertext, is what
  collides) — on BOTH the staff and the guardian self-service create paths;
* NULL / absent national_id is reusable (the partial index excludes NULLs);
* the same id is allowed in two DIFFERENT orgs (per-org scope).

Like the rest of ``tests/integration`` they need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. They
reuse the create + provisioning helpers from the sibling orphan/guardian tests.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.crypto import encrypt_field, national_id_blind_index
from app.core.database import make_session
from app.models.orphan import Orphan
from tests.integration.test_guardian_self import (
    _create_family_and_guardian,
    _link_family_to_partner,
    _seed_partner_id,
)
from tests.integration.test_orphan_country_aware import (
    _guardian_create,
    _staff_create,
    _unique_eg_id,
)
from tests.integration.test_tenant_isolation_orphans import (
    _login_as,
    _make_org,
    _make_partner,
)


async def test_duplicate_national_id_in_same_org_returns_409(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Two orphans (different names) with the same national_id in one org: the
    second is rejected with a clean 409 about the national id — distinct from
    the name-composite duplicate message."""
    partner_id = await _seed_partner_id()
    nid = _unique_eg_id()  # EG: required, exactly 14 digits.

    r1 = await _staff_create(api, auth_headers, partner_id, nationality="EG", national_id=nid)
    assert r1.status_code == 201, r1.text

    # The stored blind index matches the helper, and a FRESH ciphertext of the
    # same id differs from the stored one — i.e. the ciphertext is NOT what makes
    # the duplicate detectable; the deterministic blind index is. A naive unique
    # index on national_id_encrypted would let the second create below through.
    async with make_session() as db:
        first = await db.get(Orphan, uuid.UUID(r1.json()["id"]))
    assert first is not None
    assert first.national_id_encrypted is not None
    assert first.national_id_blind_index == national_id_blind_index(nid)
    assert encrypt_field(nid) != first.national_id_encrypted  # randomised per write

    # _staff_create uses a fresh unique name each call, so this can only trip the
    # national_id index — never the name/DOB/father composite.
    r2 = await _staff_create(api, auth_headers, partner_id, nationality="EG", national_id=nid)
    assert r2.status_code == 409, r2.text
    assert "national id" in r2.json()["detail"].lower()


async def test_duplicate_national_id_on_guardian_path_returns_409(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The guardian self-service create shares the same chokepoint, so it
    enforces the national_id rule identically — the second submission 409s."""
    partner_id = await _seed_partner_id()
    family_id, _, headers = await _create_family_and_guardian(api, auth_headers)
    await _link_family_to_partner(family_id, partner_id)
    nid = _unique_eg_id()  # EG: required, exactly 14 digits.

    r1 = await _guardian_create(api, headers, nationality="EG", national_id=nid)
    assert r1.status_code == 201, r1.text

    r2 = await _guardian_create(api, headers, nationality="EG", national_id=nid)
    assert r2.status_code == 409, r2.text
    assert "national id" in r2.json()["detail"].lower()


async def test_absent_national_id_is_reusable(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A NULL/absent national_id never collides — the partial unique index
    excludes NULL blind indexes, so many orphans can omit it."""
    partner_id = await _seed_partner_id()
    ids: list[str] = []
    for _ in range(3):
        # KW = permissive baseline; national_id omitted entirely.
        r = await _staff_create(api, auth_headers, partner_id, nationality="KW")
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])

    async with make_session() as db:
        for orphan_id in ids:
            orphan = await db.get(Orphan, uuid.UUID(orphan_id))
            assert orphan is not None
            assert orphan.national_id_encrypted is None
            assert orphan.national_id_blind_index is None


async def test_same_national_id_allowed_across_organizations(api: AsyncClient) -> None:
    """Uniqueness is per-organization (matching idx_orphans_no_duplicate): the
    same national_id may be registered in two different orgs."""
    nid = "ALLOWED-ACROSS-ORGS"  # KW baseline accepts any shape; reused in both orgs.

    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    headers_a = await _login_as(api, org_a, "org_admin")
    headers_b = await _login_as(api, org_b, "org_admin")

    r_a = await _staff_create(api, headers_a, partner_a, nationality="KW", national_id=nid)
    assert r_a.status_code == 201, r_a.text
    r_b = await _staff_create(api, headers_b, partner_b, nationality="KW", national_id=nid)
    assert r_b.status_code == 201, r_b.text

    # Both stored the identical blind index — only the org scope keeps them apart.
    async with make_session() as db:
        a = await db.get(Orphan, uuid.UUID(r_a.json()["id"]))
        b = await db.get(Orphan, uuid.UUID(r_b.json()["id"]))
    assert a is not None and b is not None
    assert a.national_id_blind_index == b.national_id_blind_index == national_id_blind_index(nid)
    assert a.organization_id != b.organization_id
