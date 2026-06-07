"""Partner-scoped enforcement on orphan writes (PR-3).

For ``PARTNER_SCOPED_ROLES`` (partner_manager, partner_staff) every write is
confined to the caller's own جهة:

* creation FORCES ``partner_organization_id`` to the caller's جهة (a payload
  trying to set another جهة is ignored), only attaches dars from that جهة, and
  a scoped user with no جهة cannot create at all (403);
* update 404s a foreign-جهة orphan (no existence leak on the write path),
  cannot move an orphan off its جهة, and only attaches dars from the caller's
  جهة.

``org_admin`` (and every non-scoped role) is unchanged: it still picks any
in-org partner organization and dar.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. They
reuse the seeded DEV org + DEV-PTN partner (جهة A).
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import make_session
from app.core.security import hash_password
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.user import User


async def _dev_org_and_partner_a() -> tuple[str, str]:
    """Return ``(organization_id, partner_a_id)`` for the seeded DEV-PTN جهة."""
    async with make_session() as db:
        partner = await db.scalar(
            select(PartnerOrganization).where(PartnerOrganization.code == "DEV-PTN")
        )
        assert partner is not None
        return str(partner.organization_id), str(partner.id)


async def _make_partner_in_org(organization_id: str) -> str:
    """A second partner organization (جهة B) inside the SAME org as جهة A."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        partner = PartnerOrganization(
            organization_id=uuid.UUID(organization_id),
            code=f"PTN-B-{suffix}",
            name_ar="جهة ب",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        return str(partner.id)


async def _scoped_user_headers(
    api: AsyncClient,
    organization_id: str,
    partner_organization_id: str | None,
    *,
    role: str = "partner_manager",
) -> dict[str, str]:
    """Create a partner-scoped user (optionally pinned to a جهة) and log in."""
    suffix = uuid.uuid4().hex[:8]
    email = f"scoped-{suffix}@example.com"
    password = "scopedpw123456"
    async with make_session() as db:
        db.add(
            User(
                organization_id=uuid.UUID(organization_id),
                partner_organization_id=(
                    uuid.UUID(partner_organization_id) if partner_organization_id else None
                ),
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


async def _make_dar(api: AsyncClient, headers: dict[str, str], partner_organization_id: str) -> str:
    """Create a dar pinned to ``partner_organization_id`` via the admin API."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={
            "name_ar": f"دار-{suffix}",
            "name_en": f"Dar {suffix}",
            "partner_organization_id": partner_organization_id,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _orphan_body(partner_id: str, **extra: object) -> dict[str, object]:
    suffix = uuid.uuid4().hex[:6]
    return {
        "first_name": f"يتيم-{suffix}",
        "family_name": "نطاق",
        "date_of_birth": "2015-04-01",
        "gender": "M",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
        **extra,
    }


# ── Creation ─────────────────────────────────────────────────────────────


async def test_scoped_create_forces_own_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A scoped manager in جهة A passing partner_organization_id=B lands on A."""
    org_id, partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)
    headers = await _scoped_user_headers(api, org_id, partner_a)

    r = await api.post("/api/v1/orphans", json=_orphan_body(partner_b), headers=headers)
    assert r.status_code == 201, r.text
    # The payload asked for جهة B; enforcement overrode it to the caller's جهة A.
    assert r.json()["partner_organization_id"] == partner_a


async def test_scoped_create_foreign_dar_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A scoped manager in جهة A cannot attach a dar owned by جهة B → 400."""
    org_id, partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)
    dar_b = await _make_dar(api, auth_headers, partner_b)
    headers = await _scoped_user_headers(api, org_id, partner_a)

    r = await api.post(
        "/api/v1/orphans",
        json=_orphan_body(partner_a, orphanage_id=dar_b),
        headers=headers,
    )
    assert r.status_code == 400, r.text


async def test_scoped_create_own_dar_ok(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A dar in the caller's own جهة A attaches fine."""
    org_id, partner_a = await _dev_org_and_partner_a()
    dar_a = await _make_dar(api, auth_headers, partner_a)
    headers = await _scoped_user_headers(api, org_id, partner_a)

    r = await api.post(
        "/api/v1/orphans",
        json=_orphan_body(partner_a, orphanage_id=dar_a),
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["orphanage_id"] == dar_a
    assert r.json()["partner_organization_id"] == partner_a


async def test_scoped_create_without_jiha_forbidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A scoped user with no جهة assigned cannot create orphans → 403."""
    org_id, partner_a = await _dev_org_and_partner_a()
    headers = await _scoped_user_headers(api, org_id, None)

    r = await api.post("/api/v1/orphans", json=_orphan_body(partner_a), headers=headers)
    assert r.status_code == 403, r.text


# ── Update / assignment ──────────────────────────────────────────────────


async def test_scoped_patch_foreign_orphan_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An orphan in جهة B is invisible to a جهة-A manager on the write path."""
    org_id, partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)
    # org_admin creates the orphan directly in جهة B.
    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_b), headers=auth_headers)
    ).json()
    headers = await _scoped_user_headers(api, org_id, partner_a)

    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"first_name": "محاولة"},
        headers=headers,
    )
    assert r.status_code == 404, r.text


async def test_scoped_patch_cannot_move_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A scoped caller cannot move an orphan off their جهة. partner_organization_id
    is not an OrphanUpdate field, so a body trying to set it is ignored and the
    orphan stays on جهة A (the edit otherwise succeeds)."""
    org_id, partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)
    headers = await _scoped_user_headers(api, org_id, partner_a)

    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_a), headers=headers)
    ).json()
    assert created["partner_organization_id"] == partner_a

    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"first_name": "تحديث", "partner_organization_id": partner_b},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["partner_organization_id"] == partner_a

    # Confirm at the DB level too — nothing slipped the orphan onto جهة B.
    async with make_session() as db:
        orphan = await db.get(Orphan, uuid.UUID(created["id"]))
        assert orphan is not None
        assert str(orphan.partner_organization_id) == partner_a


async def test_scoped_patch_foreign_dar_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A scoped manager cannot attach a جهة-B dar on update → 400."""
    org_id, partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)
    dar_b = await _make_dar(api, auth_headers, partner_b)
    headers = await _scoped_user_headers(api, org_id, partner_a)

    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_a), headers=headers)
    ).json()

    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"orphanage_id": dar_b},
        headers=headers,
    )
    assert r.status_code == 400, r.text


async def test_scoped_patch_own_dar_ok(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A dar in the caller's own جهة attaches fine on update."""
    org_id, partner_a = await _dev_org_and_partner_a()
    dar_a = await _make_dar(api, auth_headers, partner_a)
    headers = await _scoped_user_headers(api, org_id, partner_a)

    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_a), headers=headers)
    ).json()

    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"orphanage_id": dar_a},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["orphanage_id"] == dar_a


# ── Non-scoped (org_admin) unchanged ─────────────────────────────────────


async def test_org_admin_create_picks_any_in_org_partner(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """org_admin is not partner-scoped: the supplied جهة B stands."""
    org_id, _partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)

    r = await api.post("/api/v1/orphans", json=_orphan_body(partner_b), headers=auth_headers)
    assert r.status_code == 201, r.text
    assert r.json()["partner_organization_id"] == partner_b


async def test_org_admin_patch_unchanged(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """org_admin update path is unaffected by partner scoping."""
    org_id, partner_a = await _dev_org_and_partner_a()
    partner_b = await _make_partner_in_org(org_id)
    dar_b = await _make_dar(api, auth_headers, partner_b)

    created = (
        await api.post("/api/v1/orphans", json=_orphan_body(partner_a), headers=auth_headers)
    ).json()
    # An org_admin can attach a dar from any in-org جهة (org-validated only).
    r = await api.patch(
        f"/api/v1/orphans/{created['id']}",
        json={"orphanage_id": dar_b},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["orphanage_id"] == dar_b
