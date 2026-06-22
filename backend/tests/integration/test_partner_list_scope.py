"""Org + role + جهة scoping for GET /partners (list_partners).

The list is gated to staff who legitimately need it (admins, finance,
partner_manager / partner_staff) and is org-scoped explicitly — never via
RLS, which the superuser app connection bypasses. Partner-scoped roles see
only their own جهة; a scoped user with no جهة set sees an empty page; pure
consumers (donor) are 403'd.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.partner import PartnerOrganization
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL


async def _seed_org_id() -> UUID:
    """The DEV org that ``auth_headers`` belongs to."""
    async with make_session() as db:
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert admin is not None
        return admin.organization_id


async def _make_partner_org(org_id: UUID, country_code: str = "KW") -> str:
    """Create a جهة (partner org) in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        partner = PartnerOrganization(
            organization_id=org_id,
            code=f"PLS-{suffix}",
            name_ar=f"جهة-{suffix}",
            country_code=country_code,
            status="active",
        )
        db.add(partner)
        await db.commit()
        await db.refresh(partner)
        return str(partner.id)


async def _make_other_org_with_partner() -> tuple[UUID, str]:
    """A brand-new organization (org B) with one partner org of its own."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"OTP-{suffix[:6].upper()}",
            name_ar="منظمة أخرى",
            name_en="Other Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
        partner = PartnerOrganization(
            organization_id=org.id,
            code=f"OTP-PTN-{suffix[:6]}",
            name_ar=f"جهة أخرى-{suffix[:6]}",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        await db.refresh(partner)
        return org.id, str(partner.id)


async def _login_as(
    api: AsyncClient,
    org_id: UUID,
    role: str,
    partner_org_id: str | None = None,
) -> dict[str, str]:
    """Create a user with ``role`` in ``org_id`` (optionally scoped to a جهة)
    and return its auth headers."""
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@dev.example.com"
    password = "scopedpw123456"
    async with make_session() as db:
        db.add(
            User(
                organization_id=org_id,
                partner_organization_id=UUID(partner_org_id) if partner_org_id else None,
                email=email,
                password_hash=hash_password(password),
                first_name="Scoped",
                last_name="User",
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _list_ids(api: AsyncClient, headers: dict[str, str]) -> tuple[set[str], int]:
    r = await api.get("/api/v1/partners?limit=100", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    return {p["id"] for p in body["items"]}, body["total"]


async def test_list_partners_cross_org_isolation(api: AsyncClient) -> None:
    """An org-B admin never sees org A's partners (and vice versa), in items
    or in the total."""
    org_a = await _seed_org_id()
    jiha_a = await _make_partner_org(org_a)
    org_b, jiha_b = await _make_other_org_with_partner()

    admin_a = await _login_as(api, org_a, "org_admin")
    admin_b = await _login_as(api, org_b, "org_admin")

    ids_a, _ = await _list_ids(api, admin_a)
    assert jiha_a in ids_a
    assert jiha_b not in ids_a

    ids_b, total_b = await _list_ids(api, admin_b)
    assert ids_b == {jiha_b}
    assert total_b == 1


async def test_admin_sees_full_in_org_list(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The org admin keeps the full in-organization list — both جهتين."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)

    ids, total = await _list_ids(api, auth_headers)
    assert {jiha_a, jiha_b} <= ids
    assert total >= 2


@pytest.mark.parametrize("role", ["partner_manager", "partner_staff"])
async def test_partner_scoped_role_sees_only_own_jiha(api: AsyncClient, role: str) -> None:
    """A partner-scoped user sees exactly its own جهة — never a sibling جهة,
    and the total matches."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    await _make_partner_org(org_id)  # sibling جهة that must stay hidden

    scoped = await _login_as(api, org_id, role, jiha_a)
    ids, total = await _list_ids(api, scoped)
    assert ids == {jiha_a}
    assert total == 1


@pytest.mark.parametrize("role", ["partner_manager", "partner_staff"])
async def test_partner_scoped_role_without_jiha_sees_nothing(api: AsyncClient, role: str) -> None:
    """A partner-scoped user with no جهة set gets an empty page — never the
    full org list."""
    org_id = await _seed_org_id()
    await _make_partner_org(org_id)  # exists, must stay hidden

    scoped = await _login_as(api, org_id, role, None)
    ids, total = await _list_ids(api, scoped)
    assert ids == set()
    assert total == 0


async def test_finance_sees_full_in_org_list(api: AsyncClient) -> None:
    """finance needs the list for the bank-transfer screens and keeps full
    in-org visibility (it is not partner-scoped)."""
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)

    finance = await _login_as(api, org_id, "finance")
    ids, _ = await _list_ids(api, finance)
    assert {jiha_a, jiha_b} <= ids


async def test_country_code_filter_returns_only_that_country(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The optional country_code filter narrows the list to جهات in that
    country — still org-scoped — and normalises case to match storage."""
    org_id = await _seed_org_id()
    jiha_eg = await _make_partner_org(org_id, country_code="EG")
    jiha_ps = await _make_partner_org(org_id, country_code="PS")

    async def _filtered_ids(country: str) -> set[str]:
        r = await api.get(
            f"/api/v1/partners?limit=100&country_code={country}", headers=auth_headers
        )
        assert r.status_code == 200, r.text
        return {p["id"] for p in r.json()["items"]}

    eg_ids = await _filtered_ids("EG")
    assert jiha_eg in eg_ids
    assert jiha_ps not in eg_ids
    # Every returned جهة really is EG (no other country leaks in).
    r = await api.get("/api/v1/partners?limit=100&country_code=EG", headers=auth_headers)
    assert all(p["country_code"] == "EG" for p in r.json()["items"]), r.text

    # Lower-case input is normalised to the stored upper-case code.
    assert jiha_ps in await _filtered_ids("ps")
    assert jiha_eg not in await _filtered_ids("ps")


async def test_consumer_role_is_forbidden(api: AsyncClient) -> None:
    """A pure consumer (donor) gets 403 — authentication alone no longer
    grants the partner list."""
    org_id = await _seed_org_id()
    donor = await _login_as(api, org_id, "donor")
    r = await api.get("/api/v1/partners", headers=donor)
    assert r.status_code == 403, r.text
