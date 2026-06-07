"""User → partner organization link (migration 0013) — invite + update plumbing.

Exercises the additive ``users.partner_organization_id`` foundation through the
admin API:

* invite accepts an optional ``partner_organization_id`` and persists it;
* the admin patch endpoint sets the link, and a present-and-null clears it;
* a ``partner_organization_id`` that does not belong to the caller's org is
  rejected with 400 (mirrors ``_assert_orphanage_in_org``), proving the link is
  org-scoped rather than merely existence-checked.

This PR is purely additive — there is no list filtering or role enforcement to
assert here yet. Like the rest of ``tests/integration`` these need a real
Postgres with the migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise
they skip. They reuse the seeded DEV org + DEV-PTN partner.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.database import make_session
from app.models.organization import Organization
from app.models.partner import PartnerOrganization


async def _seed_partner_id(api: AsyncClient, auth_headers: dict[str, str]) -> str:
    """The DEV-PTN partner that ``seed()`` creates in the caller's org."""
    r = await api.get("/api/v1/partners?limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    for it in items:
        if it["code"] == "DEV-PTN":
            return it["id"]
    assert items, "expected at least one seeded partner organization"
    return items[0]["id"]


async def _make_foreign_partner() -> str:
    """A partner org under a *different* organization (the cross-org case)."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        org = Organization(
            code=f"FOR-{suffix}",
            name_ar="منظمة أجنبية",
            name_en="Foreign Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
        partner = PartnerOrganization(
            organization_id=org.id,
            code=f"FOR-PTN-{suffix}",
            name_ar="جهة أجنبية",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        return str(partner.id)


async def test_invite_with_partner_org_persists(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id(api, auth_headers)
    email = f"po-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "PO",
            "last_name": "User",
            "role": "partner_staff",
            "partner_organization_id": partner_id,
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["user"]["partner_organization_id"] == partner_id


async def test_invite_unknown_partner_org_400(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    email = f"po-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/users/invite",
        json={
            "email": email,
            "first_name": "PO",
            "last_name": "User",
            "role": "partner_staff",
            "partner_organization_id": str(uuid.uuid4()),
        },
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text


async def test_update_user_sets_and_clears_partner_org(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id(api, auth_headers)
    email = f"po-{uuid.uuid4().hex[:8]}@example.com"
    inv = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "PO", "last_name": "User", "role": "partner_staff"},
        headers=auth_headers,
    )
    assert inv.status_code == 201, inv.text
    user_id = inv.json()["user"]["id"]
    assert inv.json()["user"]["partner_organization_id"] is None

    # Set the link.
    r = await api.patch(
        f"/api/v1/users/{user_id}",
        json={"partner_organization_id": partner_id},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["partner_organization_id"] == partner_id

    # Present-and-null clears it.
    r = await api.patch(
        f"/api/v1/users/{user_id}",
        json={"partner_organization_id": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["partner_organization_id"] is None


async def test_update_user_foreign_org_partner_400(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    foreign_id = await _make_foreign_partner()
    email = f"po-{uuid.uuid4().hex[:8]}@example.com"
    inv = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "PO", "last_name": "User", "role": "partner_staff"},
        headers=auth_headers,
    )
    assert inv.status_code == 201, inv.text
    user_id = inv.json()["user"]["id"]

    r = await api.patch(
        f"/api/v1/users/{user_id}",
        json={"partner_organization_id": foreign_id},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
