"""Cross-tenant (multi-tenant) isolation for the finance routers.

The app connects to Postgres as a SUPERUSER, which BYPASSES Row-Level
Security, so every query over tenant-owned data must filter by
``organization_id`` EXPLICITLY in code. These tests stand up two
organizations — each with its own donor, sponsorship and payment (plus the
جهة + orphan a sponsorship needs) — and prove that an org-A admin can neither
list nor reach org-B's finance rows: lists/exports show only A, and every
fetch/mutation of a B row (or any create that references a B donor / orphan /
sponsorship) returns 404 (never 403/200), so the row's existence is never
leaked. A positive in-org baseline guards against a blanket break being
mistaken for isolation.

These mirror :mod:`tests.integration.test_tenant_isolation` (families /
partners) and :mod:`tests.integration.test_tenant_isolation_orphans`, and like
the rest of ``tests/integration`` need a real Postgres with the migrations
applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. Rows are inserted
directly via the ORM, and every cross-org assertion is reached before any
gateway call — the org guard fires first, so the MyFatoorah-backed
initiate/refund paths 404 without contacting the gateway.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from httpx import AsyncClient

from app.core.database import make_session
from app.core.security import hash_password
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User


async def _make_org() -> UUID:
    """Create a fresh, isolated organization and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"TIF-{suffix[:6].upper()}",
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


async def _make_orphan(org_id: UUID, partner_id: UUID) -> UUID:
    """Create an orphan in ``org_id``/``partner_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        orphan = Orphan(
            organization_id=org_id,
            partner_organization_id=partner_id,
            code=f"ORF-{suffix}",
            first_name=f"يتيم-{suffix}",
            family_name="مالية",
            date_of_birth=date(2015, 3, 14),
            gender="M",
        )
        db.add(orphan)
        await db.commit()
        await db.refresh(orphan)
        return orphan.id


async def _make_donor(org_id: UUID, *, deleted: bool = False) -> tuple[UUID, str]:
    """Create a donor in ``org_id``; return (id, code).

    ``deleted=True`` lands a soft-deleted row so the restore endpoint
    (which matches ``deleted_at IS NOT NULL``) has something to find."""
    suffix = uuid.uuid4().hex[:6]
    code = f"DON-{suffix}"
    async with make_session() as db:
        donor = Donor(
            organization_id=org_id,
            code=code,
            full_name=f"متبرع-{suffix}",
            email=f"donor-{suffix}@dev.example.com",
            deleted_at=datetime.now(UTC) if deleted else None,
        )
        db.add(donor)
        await db.commit()
        await db.refresh(donor)
        return donor.id, code


async def _make_sponsorship(org_id: UUID, donor_id: UUID, orphan_id: UUID) -> tuple[UUID, str]:
    """Create an active sponsorship in ``org_id``; return (id, code)."""
    suffix = uuid.uuid4().hex[:6]
    code = f"KAF-{suffix}"
    async with make_session() as db:
        sp = Sponsorship(
            organization_id=org_id,
            code=code,
            donor_id=donor_id,
            orphan_id=orphan_id,
            monthly_amount=Decimal("25.00"),
            currency="KWD",
            start_date=date(2024, 1, 1),
            status="active",
        )
        db.add(sp)
        await db.commit()
        await db.refresh(sp)
        return sp.id, code


async def _make_payment(org_id: UUID, donor_id: UUID) -> tuple[UUID, str]:
    """Create a completed payment in ``org_id``; return (id, code)."""
    suffix = uuid.uuid4().hex[:6]
    code = f"PAY-{suffix}"
    async with make_session() as db:
        payment = Payment(
            organization_id=org_id,
            code=code,
            donor_id=donor_id,
            amount=Decimal("25.00"),
            currency="KWD",
            payment_method="cash",
            status="completed",
            completed_at=datetime.now(UTC),
        )
        db.add(payment)
        await db.commit()
        await db.refresh(payment)
        return payment.id, code


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


async def test_finance_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A admin sees only org A's finance rows and 404s on every org-B row."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a = await _make_orphan(org_a, partner_a)
    orphan_b = await _make_orphan(org_b, partner_b)
    donor_a, donor_a_code = await _make_donor(org_a)
    donor_b, _donor_b_code = await _make_donor(org_b)
    # A soft-deleted donor in B exercises restore's deleted-row predicate and
    # the org scope together: org A must 404, not resurrect another org's row.
    deleted_donor_b, _ = await _make_donor(org_b, deleted=True)
    sponsorship_a, sponsorship_a_code = await _make_sponsorship(org_a, donor_a, orphan_a)
    sponsorship_b, _sp_b_code = await _make_sponsorship(org_b, donor_b, orphan_b)
    payment_a, payment_a_code = await _make_payment(org_a, donor_a)
    payment_b, _payment_b_code = await _make_payment(org_b, donor_b)

    headers_a = await _login_as(api, org_a, "org_admin")

    # ───────────────────────────── donors ─────────────────────────────
    # List + CSV export are org-scoped: only org A's donor, never B.
    r = await api.get("/api/v1/donors?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {d["id"] for d in r.json()["items"]} == {str(donor_a)}

    r = await api.get("/api/v1/donors/export.csv", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {row["code"] for row in csv.DictReader(io.StringIO(r.text))} == {donor_a_code}

    # Baseline: org A reaches its own donor, so the 404s below are org-scoping.
    r = await api.get(f"/api/v1/donors/{donor_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    # Every cross-org donor fetch/mutation 404s — never 200/403.
    r = await api.get(f"/api/v1/donors/{donor_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.patch(
        f"/api/v1/donors/{donor_b}", json={"phone": "+96599999999"}, headers=headers_a
    )
    assert r.status_code == 404, r.text

    # restore targets a *deleted* B row: the 404 is org scope, not the predicate.
    r = await api.post(f"/api/v1/donors/{deleted_donor_b}/restore", headers=headers_a)
    assert r.status_code == 404, r.text

    # DELETE last — a cross-org id must not soft-delete another org's donor.
    r = await api.delete(f"/api/v1/donors/{donor_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    # ─────────────────────────── sponsorships ───────────────────────────
    r = await api.get("/api/v1/sponsorships?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {s["id"] for s in r.json()["items"]} == {str(sponsorship_a)}

    r = await api.get("/api/v1/sponsorships/export.csv", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {row["code"] for row in csv.DictReader(io.StringIO(r.text))} == {sponsorship_a_code}

    r = await api.get(f"/api/v1/sponsorships/{sponsorship_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    r = await api.get(f"/api/v1/sponsorships/{sponsorship_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.patch(
        f"/api/v1/sponsorships/{sponsorship_b}", json={"notes": "محاولة"}, headers=headers_a
    )
    assert r.status_code == 404, r.text

    r = await api.post(f"/api/v1/sponsorships/{sponsorship_b}/pause", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.post(f"/api/v1/sponsorships/{sponsorship_b}/resume", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.post(
        f"/api/v1/sponsorships/{sponsorship_b}/cancel",
        json={"reason": "محاولة"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    # create_sponsorship must refuse a B donor or a B orphan — no cross-org link.
    base_sp = {"monthly_amount": "30.00", "currency": "KWD", "start_date": "2024-06-01"}
    r = await api.post(
        "/api/v1/sponsorships",
        json={**base_sp, "donor_id": str(donor_b), "orphan_id": str(orphan_b)},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text  # B donor

    r = await api.post(
        "/api/v1/sponsorships",
        json={**base_sp, "donor_id": str(donor_a), "orphan_id": str(orphan_b)},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text  # A donor, B orphan

    # ───────────────────────────── payments ─────────────────────────────
    r = await api.get("/api/v1/payments?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {p["id"] for p in r.json()["items"]} == {str(payment_a)}

    r = await api.get("/api/v1/payments/export.csv", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {row["code"] for row in csv.DictReader(io.StringIO(r.text))} == {payment_a_code}

    # Baseline: org A reads its own receipt; the cross-org one 404s.
    r = await api.get(f"/api/v1/payments/{payment_a}/receipt", headers=headers_a)
    assert r.status_code == 200, r.text

    r = await api.get(f"/api/v1/payments/{payment_b}/receipt", headers=headers_a)
    assert r.status_code == 404, r.text

    # refund / status 404 on the org guard, before any gateway call or state check.
    r = await api.post(
        f"/api/v1/payments/{payment_b}/refund",
        json={"amount": "1.00", "reason": "محاولة"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    r = await api.post(
        f"/api/v1/payments/{payment_b}/status",
        json={"status": "failed", "reason": "محاولة"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    # create / initiate / admin-initiate must refuse a B donor or B sponsorship.
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": str(donor_b),
            "amount": "5.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=headers_a,
    )
    assert r.status_code == 404, r.text  # B donor

    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": str(donor_a),
            "sponsorship_id": str(sponsorship_b),
            "amount": "5.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=headers_a,
    )
    assert r.status_code == 404, r.text  # A donor, B sponsorship

    # initiate / admin-initiate 404 on the donor before MyFatoorah is touched.
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": str(donor_b), "amount": "5.00", "currency": "KWD"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": str(donor_b), "amount": "5.00", "currency": "KWD"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text
