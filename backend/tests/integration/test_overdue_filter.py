"""Overdue donor/sponsorship filters (Phase 4 finance prerequisites).

Covers the new `min_months_overdue` / `is_overdue` params on
GET /sponsorships and the `donor_overdue` shortcut on GET /payments:
happy path, no-match → empty, tenant isolation, and the finance/admin
role gate (403 for everyone else).
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_donor(api: AsyncClient, h: dict[str, str]) -> str:
    email = f"od-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post("/api/v1/donors", json={"full_name": "كافل", "email": email}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يتيم-{unique}",
            "family_name": "متأخر",
            "date_of_birth": "2017-08-10",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{unique}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _make_sponsorship(
    api: AsyncClient, h: dict[str, str], donor_id: str, orphan_id: str
) -> dict:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _set_overdue(sponsorship_id: str, months: int, status: str = "active") -> None:
    async with make_session() as db:
        await db.execute(
            text("UPDATE sponsorships SET months_overdue = :m, status = :s WHERE id = :id"),
            {"m": months, "s": status, "id": sponsorship_id},
        )
        await db.commit()


async def _login_as(api: AsyncClient, admin_headers: dict[str, str], role: str) -> dict[str, str]:
    """Invite + accept + login a user with `role` in the admin's org."""
    email = f"{role[:3]}-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": role.title(), "last_name": "User", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    token = r.json()["invite_token"]
    r = await api.post("/api/v1/users/accept-invite", json={"token": token, "password": password})
    assert r.status_code == 200, r.text
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_org_token(api: AsyncClient, role: str = "org_admin") -> dict[str, str]:
    """Create a fresh organization + active user with `role`, return headers."""
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OTH-{suffix[:6].upper()}",
            name_ar="منظمة أخرى",
            name_en="Other Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
        db.add(
            User(
                organization_id=org.id,
                email=email,
                password_hash=hash_password(password),
                first_name="Other",
                last_name="Finance",
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── GET /sponsorships overdue filter ────────────────────────────────────


async def test_min_months_overdue_filters(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_a = await _make_orphan(api, auth_headers)
    orphan_b = await _make_orphan(api, auth_headers)
    overdue = await _make_sponsorship(api, auth_headers, donor_id, orphan_a)
    current = await _make_sponsorship(api, auth_headers, donor_id, orphan_b)
    await _set_overdue(overdue["id"], months=3)
    await _set_overdue(current["id"], months=0)

    r = await api.get("/api/v1/sponsorships?min_months_overdue=2&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert overdue["id"] in ids
    assert current["id"] not in ids


async def test_is_overdue_shorthand(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_a = await _make_orphan(api, auth_headers)
    orphan_b = await _make_orphan(api, auth_headers)
    overdue = await _make_sponsorship(api, auth_headers, donor_id, orphan_a)
    current = await _make_sponsorship(api, auth_headers, donor_id, orphan_b)
    await _set_overdue(overdue["id"], months=1)
    await _set_overdue(current["id"], months=0)

    r = await api.get("/api/v1/sponsorships?is_overdue=true&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert overdue["id"] in ids
    assert current["id"] not in ids


async def test_overdue_excludes_non_active(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)
    # Behind by 5 months but cancelled — must not surface as overdue.
    await _set_overdue(sp["id"], months=5, status="cancelled")

    r = await api.get("/api/v1/sponsorships?min_months_overdue=1&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert sp["id"] not in ids


async def test_overdue_no_match_returns_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)
    await _set_overdue(sp["id"], months=2)

    r = await api.get("/api/v1/sponsorships?min_months_overdue=99&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["items"] == []


async def test_overdue_tenant_isolation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)
    await _set_overdue(sp["id"], months=4)

    other = await _new_org_token(api, role="finance")
    r = await api.get("/api/v1/sponsorships?is_overdue=true&limit=100", headers=other)
    assert r.status_code == 200, r.text
    ids = {item["id"] for item in r.json()["items"]}
    assert sp["id"] not in ids


async def test_sponsorships_role_forbidden(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    staff = await _login_as(api, auth_headers, "partner_staff")
    r = await api.get("/api/v1/sponsorships?is_overdue=true", headers=staff)
    assert r.status_code == 403, r.text


# ── GET /payments?donor_overdue ─────────────────────────────────────────


async def test_donor_overdue_returns_last_payment(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)
    await _set_overdue(sp["id"], months=2)

    # Two payments for the donor — only the latest should come back.
    for _ in range(2):
        r = await api.post(
            "/api/v1/payments",
            json={
                "donor_id": donor_id,
                "sponsorship_id": sp["id"],
                "amount": "20.00",
                "currency": "KWD",
                "payment_method": "cash",
            },
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text

    r = await api.get("/api/v1/payments?donor_overdue=true&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    rows_for_donor = [item for item in r.json()["items"] if item["donor_id"] == donor_id]
    assert len(rows_for_donor) == 1


async def test_donor_overdue_excludes_non_overdue_donor(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor_id, orphan_id)
    await _set_overdue(sp["id"], months=0)  # current, not overdue
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "sponsorship_id": sp["id"],
            "amount": "20.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text

    r = await api.get("/api/v1/payments?donor_overdue=true&limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert all(item["donor_id"] != donor_id for item in r.json()["items"])


async def test_payments_role_forbidden(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    staff = await _login_as(api, auth_headers, "partner_staff")
    r = await api.get("/api/v1/payments?donor_overdue=true", headers=staff)
    assert r.status_code == 403, r.text
