"""Cross-tenant (multi-tenant) isolation for the families and partners routers.

The app connects to Postgres as a superuser, which BYPASSES Row-Level
Security, so every query must filter by ``organization_id`` explicitly in
code. These tests stand up two organizations — each with its own
family+guardian and partner جهة — and prove that an org-A user can neither
list nor reach org-B rows: the list shows only A, and every fetch/mutation of
a B row returns 404 (never 403/200), so the row's existence is never leaked.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import uuid
from uuid import UUID

from httpx import AsyncClient

from app.core.database import make_session
from app.core.security import hash_password
from app.models.family import Family, Guardian
from app.models.organization import Organization
from app.models.partner import PartnerOrganization
from app.models.user import User


async def _make_org() -> UUID:
    """Create a fresh, isolated organization and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"TEN-{suffix[:6].upper()}",
            name_ar="منظمة",
            name_en="Tenant Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)
        return org.id


async def _make_family_with_guardian(org_id: UUID) -> str:
    """Create a family + one guardian in ``org_id`` and return the family id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        family = Family(
            organization_id=org_id,
            code=f"FAM-{suffix}",
            family_name=f"عائلة-{suffix}",
            country_code="KW",
        )
        db.add(family)
        await db.flush()
        db.add(
            Guardian(
                organization_id=org_id,
                family_id=family.id,
                full_name="ولي الأمر",
                relation="mother",
            )
        )
        await db.commit()
        await db.refresh(family)
        return str(family.id)


async def _make_partner(org_id: UUID) -> str:
    """Create a جهة (partner org) in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        partner = PartnerOrganization(
            organization_id=org_id,
            code=f"PTN-{suffix}",
            name_ar=f"جهة-{suffix}",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        await db.refresh(partner)
        return str(partner.id)


async def _login_as(api: AsyncClient, org_id: UUID, role: str) -> dict[str, str]:
    """Create a user with ``role`` in ``org_id`` and return its auth headers."""
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@dev.example.com"
    password = "tenantpw123456"
    async with make_session() as db:
        db.add(
            User(
                organization_id=org_id,
                email=email,
                password_hash=hash_password(password),
                first_name="Tenant",
                last_name="User",
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_families_and_partners_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A admin sees only org A's family and 404s on every org-B row."""
    org_a = await _make_org()
    org_b = await _make_org()

    fam_a = await _make_family_with_guardian(org_a)
    fam_b = await _make_family_with_guardian(org_b)
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)

    headers_a = await _login_as(api, org_a, "org_admin")

    # GET /families lists only org A's family — org B never bleeds in.
    r = await api.get("/api/v1/families?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    ids = {f["id"] for f in r.json()["items"]}
    assert ids == {fam_a}
    assert fam_b not in ids

    # Baseline: org A reaches its own جهة, so a 404 below is org-scoping, not
    # a blanket break.
    r = await api.get(f"/api/v1/partners/{partner_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    # Every cross-org fetch/mutation 404s — never 200/403, never leaking the row.
    r = await api.get(f"/api/v1/families/{fam_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/families/{fam_b}/guardians", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.post(
        f"/api/v1/families/{fam_b}/guardians",
        json={"full_name": "محاولة", "relation": "mother"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/partners/{partner_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.patch(
        f"/api/v1/partners/{partner_b}",
        json={"name_ar": "محاولة"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    r = await api.delete(f"/api/v1/partners/{partner_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/partners/{partner_b}/stats", headers=headers_a)
    assert r.status_code == 404, r.text
