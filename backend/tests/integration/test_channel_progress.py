"""Marketing-channel goal progress (Phase 4 marketing prerequisite).

Covers GET /marketing-channels/{id}/progress: happy path with goals +
achieved sponsorships/payments, the empty (no-achievement) case, tenant
isolation, and the marketing_manager/admin role gate.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

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


async def _make_channel(api: AsyncClient, h: dict[str, str]) -> str:
    r = await api.post(
        "/api/v1/marketing-channels",
        json={"name_ar": f"قناة-{uuid.uuid4().hex[:6]}", "name_en": "Progress channel"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _set_goals(channel_id: str, count: int, amount: str, year: int) -> None:
    async with make_session() as db:
        await db.execute(
            text(
                "UPDATE marketing_channels SET annual_goal_count = :c, "
                "annual_goal_amount = :a, goal_year = :y, goal_currency = 'KWD' WHERE id = :id"
            ),
            {"c": count, "a": amount, "y": year, "id": channel_id},
        )
        await db.commit()


async def _make_donor(api: AsyncClient, h: dict[str, str]) -> str:
    email = f"cp-{uuid.uuid4().hex[:8]}@example.com"
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
            "family_name": "قناة",
            "date_of_birth": "2017-08-10",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{unique}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _make_channel_sponsorship_with_payment(
    api: AsyncClient, h: dict[str, str], channel_id: str, amount: str = "20.00"
) -> None:
    """One sponsorship (start_date in 2026) tied to the channel, plus one
    completed payment against it."""
    donor_id = await _make_donor(api, h)
    orphan_id = await _make_orphan(api, h)
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": amount,
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    sponsorship_id = r.json()["id"]
    async with make_session() as db:
        await db.execute(
            text("UPDATE sponsorships SET marketing_channel_id = :ch WHERE id = :id"),
            {"ch": channel_id, "id": sponsorship_id},
        )
        await db.commit()
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "sponsorship_id": sponsorship_id,
            "amount": amount,
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text


async def _login_as(api: AsyncClient, admin_headers: dict[str, str], role: str) -> dict[str, str]:
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


async def _new_org_token(api: AsyncClient, role: str) -> dict[str, str]:
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OTC-{suffix[:6].upper()}",
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
                last_name="Marketing",
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── tests ───────────────────────────────────────────────────────────────


async def test_channel_progress_happy_path(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    channel_id = await _make_channel(api, auth_headers)
    await _set_goals(channel_id, count=10, amount="1000.00", year=2026)
    await _make_channel_sponsorship_with_payment(api, auth_headers, channel_id)
    await _make_channel_sponsorship_with_payment(api, auth_headers, channel_id)

    r = await api.get(f"/api/v1/marketing-channels/{channel_id}/progress", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["goal_year"] == 2026
    assert body["annual_goal_count"] == 10
    assert Decimal(body["annual_goal_amount"]) == Decimal("1000.00")
    assert body["achieved_count"] == 2
    assert Decimal(body["achieved_amount"]) == Decimal("40.00")
    assert body["completion_percentage_count"] == 20.0
    assert body["completion_percentage_amount"] == 4.0
    # Sponsorships started in January, payments completed "today" (current month).
    assert body["monthly_achieved_count"] == 0
    assert Decimal(body["monthly_achieved_amount"]) == Decimal("40.00")


async def test_channel_progress_no_achievement(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    channel_id = await _make_channel(api, auth_headers)
    await _set_goals(channel_id, count=5, amount="500.00", year=2026)

    r = await api.get(f"/api/v1/marketing-channels/{channel_id}/progress", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["achieved_count"] == 0
    assert Decimal(body["achieved_amount"]) == Decimal("0")
    assert body["completion_percentage_count"] == 0.0
    assert body["completion_percentage_amount"] == 0.0


async def test_channel_progress_unknown_channel_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.get(f"/api/v1/marketing-channels/{uuid.uuid4()}/progress", headers=auth_headers)
    assert r.status_code == 404


async def test_channel_progress_tenant_isolation(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    channel_id = await _make_channel(api, auth_headers)
    await _set_goals(channel_id, count=10, amount="1000.00", year=2026)

    other = await _new_org_token(api, role="marketing_manager")
    r = await api.get(f"/api/v1/marketing-channels/{channel_id}/progress", headers=other)
    # Channel belongs to another org → not visible.
    assert r.status_code == 404, r.text


async def test_channel_progress_role_forbidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    channel_id = await _make_channel(api, auth_headers)
    staff = await _login_as(api, auth_headers, "partner_staff")
    r = await api.get(f"/api/v1/marketing-channels/{channel_id}/progress", headers=staff)
    assert r.status_code == 403, r.text
