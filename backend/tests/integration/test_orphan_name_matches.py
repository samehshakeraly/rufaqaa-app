"""Advisory soft duplicate-name lookup (``GET /orphans/name-matches``, PR D).

This is the NON-BLOCKING counterpart to the hard duplicate guards. When a staff
user registers an orphan WITHOUT a national_id, the form first calls this
endpoint with the entered first + family name; if it returns any rows, the form
warns that a child with this name already exists and lets the user confirm it is
not a duplicate before proceeding. It NEVER blocks a create — the hard
``idx_orphans_no_duplicate`` composite and the ``national_id`` blind index still
own the 409.

These exercise the endpoint end-to-end:

* matching is case-insensitive (mirrors ``_find_duplicate``'s ``LOWER()``);
* the result is org-scoped — another org's identically-named orphan never leaks;
* soft-deleted orphans are excluded;
* the response carries ONLY the non-sensitive identity fields — never
  ``national_id`` (or its blind index);
* an absent name match returns an empty list;
* both query params are required, and the lookup is gated to the orphan-creator
  roles (a staff-but-non-creator role is 403'd).

Like the rest of ``tests/integration`` they need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. They
reuse the provisioning helpers from the sibling orphan tests.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient, Response

from app.core.database import make_session
from app.models.orphan import Orphan
from tests.integration.test_guardian_self import _seed_partner_id
from tests.integration.test_orphan_country_aware import _unique_eg_id
from tests.integration.test_tenant_isolation_orphans import (
    _login_as,
    _make_org,
    _make_partner,
)

# The exact, complete shape of an OrphanNameMatch row. Asserting equality (not
# just "national_id absent") locks the contract: nothing sensitive can be added
# to the advisory response by accident.
_EXPECTED_KEYS = {"code", "first_name", "father_name", "family_name", "date_of_birth"}


def _named_payload(
    partner_id: str, first_name: str, family_name: str, **overrides: Any
) -> dict[str, Any]:
    """A minimal staff-create payload with explicit first/family names. A unique
    father_name keeps each create clear of the name/DOB/father composite guard,
    so two orphans can share a first+family name without a 409."""
    suffix = uuid.uuid4().hex[:8]
    payload: dict[str, Any] = {
        "first_name": first_name,
        "family_name": family_name,
        "date_of_birth": "2015-06-01",
        "gender": "M",
        "father_name": f"father-{suffix}",
        "partner_organization_id": partner_id,
        "nationality": "KW",  # permissive baseline → national_id optional
    }
    payload.update(overrides)
    return payload


async def _create_named(
    api: AsyncClient,
    headers: dict[str, str],
    partner_id: str,
    first_name: str,
    family_name: str,
    **overrides: Any,
) -> Response:
    payload = _named_payload(partner_id, first_name, family_name, **overrides)
    return await api.post("/api/v1/orphans", json=payload, headers=headers)


async def _name_matches(
    api: AsyncClient, headers: dict[str, str], first_name: str, family_name: str
) -> Response:
    return await api.get(
        "/api/v1/orphans/name-matches",
        params={"first_name": first_name, "family_name": family_name},
        headers=headers,
    )


async def test_name_matches_are_case_insensitive(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A stored name is found regardless of the query's letter case — the
    endpoint compares ``LOWER()`` on both sides, exactly like the hard guard."""
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:8]
    first, family = f"Sara{suffix}", f"Hassan{suffix}"

    created = await _create_named(api, auth_headers, partner_id, first, family)
    assert created.status_code == 201, created.text
    code = created.json()["code"]

    # Query in a different case than stored (all upper) — still a hit.
    r = await _name_matches(api, auth_headers, first.upper(), family.upper())
    assert r.status_code == 200, r.text
    codes = {m["code"] for m in r.json()}
    assert code in codes

    # ...and all-lower likewise.
    r = await _name_matches(api, auth_headers, first.lower(), family.lower())
    assert r.status_code == 200, r.text
    assert code in {m["code"] for m in r.json()}


async def test_name_matches_empty_when_no_name_match(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A name nobody in the org carries returns an empty list — never an error."""
    r = await _name_matches(
        api, auth_headers, f"ghost{uuid.uuid4().hex}", f"absent{uuid.uuid4().hex}"
    )
    assert r.status_code == 200, r.text
    assert r.json() == []


async def test_name_matches_are_org_scoped(api: AsyncClient) -> None:
    """An identically-named orphan in another org never leaks: each org's admin
    sees only their own match (org scope mirrors ``idx_orphans_no_duplicate``)."""
    suffix = uuid.uuid4().hex[:8]
    first, family = f"Omar{suffix}", f"Khalid{suffix}"

    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    headers_a = await _login_as(api, org_a, "org_admin")
    headers_b = await _login_as(api, org_b, "org_admin")

    ra = await _create_named(api, headers_a, partner_a, first, family)
    rb = await _create_named(api, headers_b, partner_b, first, family)
    assert ra.status_code == 201, ra.text
    assert rb.status_code == 201, rb.text
    code_a, code_b = ra.json()["code"], rb.json()["code"]

    # Org A sees only its own row; org B's identically-named orphan is invisible.
    res_a = await _name_matches(api, headers_a, first, family)
    assert res_a.status_code == 200, res_a.text
    codes_a = {m["code"] for m in res_a.json()}
    assert codes_a == {code_a}
    assert code_b not in codes_a

    # ...and symmetrically for org B.
    res_b = await _name_matches(api, headers_b, first, family)
    assert res_b.status_code == 200, res_b.text
    assert {m["code"] for m in res_b.json()} == {code_b}


async def test_name_matches_exclude_deleted(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A soft-deleted orphan drops out of the advisory (the lookup filters on
    ``deleted_at IS NULL``, like the hard guard)."""
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:8]
    first, family = f"Layla{suffix}", f"Nour{suffix}"

    created = await _create_named(api, auth_headers, partner_id, first, family)
    assert created.status_code == 201, created.text
    orphan_id = created.json()["id"]

    # Present before deletion.
    before = await _name_matches(api, auth_headers, first, family)
    assert created.json()["code"] in {m["code"] for m in before.json()}

    # Soft-delete (admin route), then it must vanish from the advisory.
    deleted = await api.delete(f"/api/v1/orphans/{orphan_id}", headers=auth_headers)
    assert deleted.status_code == 204, deleted.text

    after = await _name_matches(api, auth_headers, first, family)
    assert after.status_code == 200, after.text
    assert after.json() == []


async def test_name_matches_response_omits_national_id(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The advisory carries ONLY the safe identity fields. Even for an orphan
    that DOES have a national_id, the response never echoes it (or its blind
    index) — the id stays write-only."""
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:8]
    first, family = f"Yousef{suffix}", f"Saleh{suffix}"

    created = await _create_named(
        api, auth_headers, partner_id, first, family, nationality="EG", national_id=_unique_eg_id()
    )
    assert created.status_code == 201, created.text
    orphan_id = created.json()["id"]

    # The orphan really does carry an encrypted national_id + blind index...
    async with make_session() as db:
        orphan = await db.get(Orphan, uuid.UUID(orphan_id))
    assert orphan is not None
    assert orphan.national_id_encrypted is not None
    assert orphan.national_id_blind_index is not None

    # ...yet the advisory row exposes none of it — exactly the five safe fields.
    r = await _name_matches(api, auth_headers, first, family)
    assert r.status_code == 200, r.text
    rows = [m for m in r.json() if m["code"] == created.json()["code"]]
    assert len(rows) == 1
    match = rows[0]
    assert set(match.keys()) == _EXPECTED_KEYS
    assert "national_id" not in match
    assert "national_id_blind_index" not in match
    assert match["first_name"] == first
    assert match["family_name"] == family


async def test_name_matches_requires_both_params(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """first_name and family_name are both required — omitting either is a 422,
    never a silent full-org dump."""
    only_first = await api.get(
        "/api/v1/orphans/name-matches", params={"first_name": "Sara"}, headers=auth_headers
    )
    assert only_first.status_code == 422, only_first.text

    neither = await api.get("/api/v1/orphans/name-matches", headers=auth_headers)
    assert neither.status_code == 422, neither.text


async def test_name_matches_gated_to_creator_roles(api: AsyncClient) -> None:
    """The lookup is gated to the orphan-creator roles (same as POST /orphans).
    A staff role that cannot register an orphan — e.g. finance — is 403'd."""
    org = await _make_org()
    headers = await _login_as(api, org, "finance")

    r = await _name_matches(api, headers, "Sara", "Hassan")
    assert r.status_code == 403, r.text
