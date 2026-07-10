"""Orphanage (dar) management CRUD + org isolation.

Mirrors test_families.py's happy-path shape and reuses the cross-org
fixture pattern from test_documents.py (a fresh org_admin in a brand-new
organization) to assert tenant isolation.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL


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


# ── Manager assignment (orphanages.manager_user_id) ──────────────────────


async def _seed_org_user_id(role: str) -> str:
    """Create a user with ``role`` in the SEEDED org (the one ``auth_headers``
    belongs to) and return its id — so it can be offered as a dar manager."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert admin is not None
        user = User(
            organization_id=admin.organization_id,
            email=f"dar-mgr-{suffix}@dev.example.com",
            password_hash=hash_password("managerpw123456"),
            first_name="Demo",
            last_name="Manager",
            role=role,
            status="active",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return str(user.id)


async def _other_org_user_id(role: str) -> str:
    """Create a user with ``role`` in a brand-new org (org B); return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"OTM-{suffix[:6].upper()}",
            name_ar="منظمة أخرى",
            name_en="Other Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
        user = User(
            organization_id=org.id,
            email=f"dar-mgr-other-{suffix}@other.example.com",
            password_hash=hash_password("managerpw123456"),
            first_name="Other",
            last_name="Manager",
            role=role,
            status="active",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return str(user.id)


async def _create_dar(api: AsyncClient, headers: dict[str, str], **extra: object) -> Response:
    suffix = uuid.uuid4().hex[:6]
    return await api.post(
        "/api/v1/orphanages",
        json={"name_ar": f"دار-{suffix}", "name_en": f"Dar {suffix}", **extra},
        headers=headers,
    )


async def test_assign_manager_on_create_set_patch_clear(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Happy path: a same-org orphanage_manager can be set at creation,
    re-assigned via PATCH, and cleared with an explicit null."""
    mgr1 = await _seed_org_user_id("orphanage_manager")
    mgr2 = await _seed_org_user_id("orphanage_manager")

    # create with a manager
    r = await _create_dar(api, auth_headers, manager_user_id=mgr1)
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    assert r.json()["manager_user_id"] == mgr1

    # PATCH → re-assign to a different manager
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"manager_user_id": mgr2},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["manager_user_id"] == mgr2

    # PATCH explicit null → cleared
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"manager_user_id": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["manager_user_id"] is None


async def test_assign_manager_via_patch_only(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A dar created without a manager can have one set later via PATCH."""
    mgr = await _seed_org_user_id("orphanage_manager")
    did = (await _create_dar(api, auth_headers)).json()["id"]

    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"manager_user_id": mgr},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["manager_user_id"] == mgr


async def test_assign_non_manager_role_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A same-org user whose role is NOT orphanage_manager → 400, on create
    and on PATCH."""
    viewer = await _seed_org_user_id("viewer")

    r = await _create_dar(api, auth_headers, manager_user_id=viewer)
    assert r.status_code == 400, r.text

    did = (await _create_dar(api, auth_headers)).json()["id"]
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"manager_user_id": viewer},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text


async def test_assign_cross_org_manager_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An orphanage_manager belonging to ANOTHER org cannot be assigned → 400."""
    foreign_mgr = await _other_org_user_id("orphanage_manager")

    r = await _create_dar(api, auth_headers, manager_user_id=foreign_mgr)
    assert r.status_code == 400, r.text


async def test_assign_manager_already_managing_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A manager already running one dar cannot be assigned to a second — on
    create AND on PATCH — but re-asserting the SAME dar's manager is fine."""
    mgr = await _seed_org_user_id("orphanage_manager")

    first = await _create_dar(api, auth_headers, manager_user_id=mgr)
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]

    # second dar, create with the same manager → 400 (clean, not a 409)
    r = await _create_dar(api, auth_headers, manager_user_id=mgr)
    assert r.status_code == 400, r.text
    assert "already manages" in r.json()["detail"]

    # a second (unmanaged) dar cannot PATCH-grab the same manager → 400
    second_id = (await _create_dar(api, auth_headers)).json()["id"]
    r = await api.patch(
        f"/api/v1/orphanages/{second_id}",
        json={"manager_user_id": mgr},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text

    # re-asserting the SAME manager on the dar that already holds them is OK
    # (the uniqueness check excludes the dar's own row).
    r = await api.patch(
        f"/api/v1/orphanages/{first_id}",
        json={"manager_user_id": mgr},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["manager_user_id"] == mgr


# ── Capacity (orphanages.capacity, 0032) ─────────────────────────────────


async def test_capacity_create_read_update_clear(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """capacity set at creation is read back, independently updatable via
    PATCH, preserved by unrelated PATCHes, and cleared by an explicit null
    (the manager_user_id present-and-null contract)."""
    r = await _create_dar(api, auth_headers, capacity=40)
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    assert r.json()["capacity"] == 40

    # GET returns it
    r = await api.get(f"/api/v1/orphanages/{did}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["capacity"] == 40

    # PATCH capacity alone — updated, nothing else touched
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"capacity": 55},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["capacity"] == 55

    # PATCH an unrelated field — capacity untouched (exclude_unset semantics)
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"city": "Hawalli"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["capacity"] == 55

    # PATCH explicit null — cleared back to NULL
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"capacity": None},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["capacity"] is None


async def test_capacity_omitted_defaults_to_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await _create_dar(api, auth_headers)
    assert r.status_code == 201, r.text
    assert r.json()["capacity"] is None


async def test_capacity_zero_is_valid(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """0 is a legal capacity (a dar with no beds) — only negatives are out."""
    r = await _create_dar(api, auth_headers, capacity=0)
    assert r.status_code == 201, r.text
    assert r.json()["capacity"] == 0


async def test_negative_capacity_rejected_by_pydantic(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The boundary rejects negatives with a 422 (Field ge=0) on create AND
    PATCH — requests never reach the DB CHECK."""
    r = await _create_dar(api, auth_headers, capacity=-1)
    assert r.status_code == 422, r.text

    did = (await _create_dar(api, auth_headers)).json()["id"]
    r = await api.patch(
        f"/api/v1/orphanages/{did}",
        json={"capacity": -5},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


async def test_negative_capacity_rejected_by_db_check(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Writing a negative capacity straight to the DB (bypassing Pydantic)
    trips the orphanages_capacity_check constraint."""
    did = (await _create_dar(api, auth_headers)).json()["id"]

    with pytest.raises(IntegrityError, match="orphanages_capacity_check"):
        async with make_session() as db:
            await db.execute(
                text("UPDATE orphanages SET capacity = -1 WHERE id = :id"),
                {"id": did},
            )
            await db.commit()
