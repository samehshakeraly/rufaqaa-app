"""Cross-tenant (multi-tenant) isolation for the accounts routers.

The app connects to Postgres as a SUPERUSER, which BYPASSES Row-Level
Security, so every query over tenant-owned data must filter by
``organization_id`` EXPLICITLY in code. These tests stand up two
organizations — each with an admin, an extra non-admin user and a bank
transfer (plus the جهة a transfer needs) — and prove that an org-A admin can
neither list nor reach org-B's accounts rows: the user and bank-transfer lists
show only A, and every cross-org user mutation (suspend / reactivate / update)
or financial mutation (approve / mark-completed / cancel / confirm-receipt)
returns 404 (never 403/200), so the row's existence is never leaked. A positive
in-org baseline guards against a blanket break being mistaken for isolation.

These mirror :mod:`tests.integration.test_tenant_isolation` (families /
partners), :mod:`tests.integration.test_tenant_isolation_orphans` and
:mod:`tests.integration.test_tenant_isolation_finance`, and like the rest of
``tests/integration`` need a real Postgres with the migrations applied
(``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. Rows are inserted
directly via the ORM. For the cross-org transfers the org guard fires before
the status check, so a `pending` transfer 404s on every state-change endpoint
without its state ever being consulted.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from uuid import UUID

from httpx import AsyncClient

from app.core.database import make_session
from app.core.security import hash_password
from app.models.bank_transfer import BankTransfer
from app.models.organization import Organization
from app.models.partner import PartnerOrganization
from app.models.user import User


async def _make_org() -> UUID:
    """Create a fresh, isolated organization and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"TIA-{suffix[:6].upper()}",
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


async def _make_partner(org_id: UUID) -> UUID:
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
        return partner.id


async def _make_user(org_id: UUID, role: str, *, status: str = "active") -> UUID:
    """Create a user with ``role`` in ``org_id`` (no login) and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        user = User(
            organization_id=org_id,
            email=f"{role[:3]}-{suffix}@dev.example.com",
            password_hash=hash_password("tenantpw123456"),
            first_name="Tenant",
            last_name="User",
            role=role,
            status=status,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user.id


async def _make_transfer(org_id: UUID, partner_id: UUID) -> UUID:
    """Create a pending bank transfer in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        transfer = BankTransfer(
            organization_id=org_id,
            code=f"TRF-{suffix}",
            partner_organization_id=partner_id,
            amount=Decimal("100.00"),
            currency="KWD",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
            status="pending",
        )
        db.add(transfer)
        await db.commit()
        await db.refresh(transfer)
        return transfer.id


async def _login_as(api: AsyncClient, org_id: UUID, role: str) -> tuple[UUID, dict[str, str]]:
    """Create a user with ``role`` in ``org_id``, log in, return (id, auth headers)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@dev.example.com"
    password = "tenantpw123456"
    async with make_session() as db:
        user = User(
            organization_id=org_id,
            email=email,
            password_hash=hash_password(password),
            first_name="Tenant",
            last_name="User",
            role=role,
            status="active",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return user_id, {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_accounts_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A admin sees only org A's users + transfers and 404s on every org-B row."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)

    admin_a, headers_a = await _login_as(api, org_a, "org_admin")
    user_a = await _make_user(org_a, "viewer")
    user_b = await _make_user(org_b, "viewer")

    transfer_a = await _make_transfer(org_a, partner_a)
    transfer_b = await _make_transfer(org_b, partner_b)

    # ───────────────────────────── users ─────────────────────────────
    # List is org-scoped: only org A's users (its admin + viewer), never B's.
    r = await api.get("/api/v1/users?limit=200", headers=headers_a)
    assert r.status_code == 200, r.text
    ids = {u["id"] for u in r.json()["items"]}
    assert ids == {str(admin_a), str(user_a)}
    assert str(user_b) not in ids

    # Baseline: org A can act on its own user, so the 404s below are org scope,
    # not a blanket break. suspend → reactivate → patch all reach user_a.
    r = await api.post(f"/api/v1/users/{user_a}/suspend", headers=headers_a)
    assert r.status_code == 200, r.text
    r = await api.post(f"/api/v1/users/{user_a}/reactivate", headers=headers_a)
    assert r.status_code == 200, r.text
    r = await api.patch(f"/api/v1/users/{user_a}", json={}, headers=headers_a)
    assert r.status_code == 200, r.text

    # Every cross-org user mutation 404s — never 200/403, never leaking existence.
    r = await api.post(f"/api/v1/users/{user_b}/suspend", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/users/{user_b}/reactivate", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.patch(f"/api/v1/users/{user_b}", json={}, headers=headers_a)
    assert r.status_code == 404, r.text

    # ───────────────────────── bank transfers ─────────────────────────
    # List is org-scoped: only org A's transfer, never B's.
    r = await api.get("/api/v1/bank-transfers?limit=200", headers=headers_a)
    assert r.status_code == 200, r.text
    ids = {t["id"] for t in r.json()["items"]}
    assert ids == {str(transfer_a)}
    assert str(transfer_b) not in ids

    # Baseline: org A reaches its own transfer (pending → approved), so the 404s
    # below are org scope, not a blanket break.
    r = await api.post(f"/api/v1/bank-transfers/{transfer_a}/approve", headers=headers_a)
    assert r.status_code == 200, r.text

    # Every cross-org financial mutation 404s — the org guard fires before the
    # status check, so transfer_b's `pending` state is never consulted.
    r = await api.post(f"/api/v1/bank-transfers/{transfer_b}/approve", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/bank-transfers/{transfer_b}/mark-completed", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/bank-transfers/{transfer_b}/cancel", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/bank-transfers/{transfer_b}/confirm-receipt", headers=headers_a)
    assert r.status_code == 404, r.text
