"""Assign an orphan to a dar (orphanage) — staff create/edit, org-validated.

Covers the staff happy paths (create with a dar, PATCH set/clear) and the
security rule: a cross-org orphanage_id is rejected with 400 on both create
and update. The guardian self-service path is covered in test_guardian_self.py
(it can never set orphanage_id).
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


async def _make_orphanage(api: AsyncClient, headers: dict[str, str]) -> str:
    """Create a dar via the org-scoped endpoint and return its id."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={"name_ar": f"دار-{suffix}", "name_en": f"Dar {suffix}"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _other_org_headers(api: AsyncClient) -> dict[str, str]:
    """A fresh org_admin in a brand-new organization (org B). Mirrors the
    cross-org fixture in test_orphanages.py."""
    suffix = uuid.uuid4().hex[:8]
    email = f"orph-assign-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OAS-{suffix[:6].upper()}",
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
                last_name="Admin",
                role="org_admin",
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _orphan_body(partner_id: str, **extra: object) -> dict[str, object]:
    suffix = uuid.uuid4().hex[:6]
    return {
        "first_name": f"دار-{suffix}",
        "family_name": "مقيم",
        "date_of_birth": "2015-04-01",
        "gender": "M",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
        **extra,
    }


async def test_staff_create_with_same_org_orphanage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    dar_id = await _make_orphanage(api, auth_headers)

    r = await api.post(
        "/api/v1/orphans",
        json=_orphan_body(partner_id, orphanage_id=dar_id),
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["orphanage_id"] == dar_id


async def test_staff_patch_sets_then_clears_orphanage(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    dar_id = await _make_orphanage(api, auth_headers)

    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_id), headers=auth_headers)
    ).json()
    assert created["orphanage_id"] is None  # family home by default

    # set
    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"orphanage_id": dar_id},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["orphanage_id"] == dar_id

    # clear (explicit null → family home)
    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"orphanage_id": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["orphanage_id"] is None


async def test_staff_create_cross_org_orphanage_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A dar owned by ANOTHER org cannot be assigned at creation → 400."""
    partner_id = await _seed_partner_id()
    other = await _other_org_headers(api)
    foreign_dar = await _make_orphanage(api, other)

    r = await api.post(
        "/api/v1/orphans",
        json=_orphan_body(partner_id, orphanage_id=foreign_dar),
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text


async def test_staff_patch_cross_org_orphanage_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A dar owned by ANOTHER org cannot be assigned on update → 400."""
    partner_id = await _seed_partner_id()
    other = await _other_org_headers(api)
    foreign_dar = await _make_orphanage(api, other)

    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_id), headers=auth_headers)
    ).json()

    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"orphanage_id": foreign_dar},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    # The rejected update left the orphan unassigned.
    after = await api.get(f"/api/v1/orphans/{created['id']}", headers=auth_headers)
    assert after.json()["orphanage_id"] is None
