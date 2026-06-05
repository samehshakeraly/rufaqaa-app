"""Orphanage (dar) management CRUD + org isolation.

Mirrors test_families.py's happy-path shape and reuses the cross-org
fixture pattern from test_documents.py (a fresh org_admin in a brand-new
organization) to assert tenant isolation.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User


async def _other_org_headers(api: AsyncClient) -> dict[str, str]:
    """A fresh org_admin in a brand-new organization (org B)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"dar-other-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OTD-{suffix[:6].upper()}",
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


async def test_orphanage_crud_roundtrip(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    suffix = uuid.uuid4().hex[:6]

    # create
    r = await api.post(
        "/api/v1/orphanages",
        json={
            "name_ar": f"دار-{suffix}",
            "name_en": f"Dar {suffix}",
            "country_code": "KW",
            "city": "Kuwait City",
            "status": "active",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    dar = r.json()
    did = dar["id"]
    assert dar["code"].startswith("DAR-")
    assert dar["status"] == "active"

    # list — the new dar is present
    r = await api.get("/api/v1/orphanages", headers=auth_headers)
    assert r.status_code == 200
    assert any(o["id"] == did for o in r.json()["items"])

    # get
    r = await api.get(f"/api/v1/orphanages/{did}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["name_en"] == f"Dar {suffix}"

    # patch — update only provided fields
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"city": "Hawalli", "status": "archived"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["city"] == "Hawalli"
    assert updated["status"] == "archived"
    assert updated["name_en"] == f"Dar {suffix}"  # untouched fields preserved


async def test_orphanage_org_isolation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A dar created in org A is invisible to a user in org B: absent from
    org B's list, and a 404 on GET /{id}."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={"name_ar": f"دار-{suffix}", "name_en": f"Dar {suffix}"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    did = r.json()["id"]

    other = await _other_org_headers(api)

    # org B cannot see org A's dar in the list
    r = await api.get("/api/v1/orphanages", headers=other)
    assert r.status_code == 200
    assert all(o["id"] != did for o in r.json()["items"])

    # GET /{id} of org A's dar is a 404 for org B
    r = await api.get(f"/api/v1/orphanages/{did}", headers=other)
    assert r.status_code == 404, r.text


async def test_orphanage_get_patch_unknown_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    bogus = str(uuid.uuid4())
    r = await api.get(f"/api/v1/orphanages/{bogus}", headers=auth_headers)
    assert r.status_code == 404
    r = await api.patch(
        f"/api/v1/orphanages/{bogus}",
        json={"city": "Nowhere"},
        headers=auth_headers,
    )
    assert r.status_code == 404
