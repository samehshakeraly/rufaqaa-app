"""Partner (جهة) scoping for the staff orphan + orphanage read/write surfaces.

partner_manager / partner_staff are confined to their own جهة
(``partner_organization_id``): list, detail and CSV expose only their جهة's
rows, a row in another جهة 404s (existence stays hidden), and a scoped user with
no جهة set sees nothing. PATCH /orphans/{id} may only attach a dar inside the
caller's جهة. org_admin is unaffected — it keeps full org-level visibility and
the org-level dar check.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. They
reuse the seeded DEV org + admin (``auth_headers``).
"""

from __future__ import annotations

import csv
import io
from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import make_session
from app.core.security import hash_password
from app.models.partner import PartnerOrganization
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL


async def _seed_org_id() -> UUID:
    """The DEV org that ``auth_headers`` belongs to."""
    async with make_session() as db:
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert admin is not None
        return admin.organization_id


async def _make_partner_org(org_id: UUID) -> str:
    """Create a جهة (partner org) in ``org_id`` and return its id."""
    suffix = uuid4().hex[:6]
    async with make_session() as db:
        partner = PartnerOrganization(
            organization_id=org_id,
            code=f"PSC-{suffix}",
            name_ar=f"جهة-{suffix}",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        await db.refresh(partner)
        return str(partner.id)


async def _login_partner_manager(
    api: AsyncClient, org_id: UUID, partner_org_id: str | None
) -> dict[str, str]:
    """Create a partner_manager in ``org_id`` scoped to ``partner_org_id``
    (or NULL) and return its auth headers."""
    suffix = uuid4().hex[:8]
    email = f"pm-{suffix}@dev.example.com"
    password = "managerpw123456"
    async with make_session() as db:
        db.add(
            User(
                organization_id=org_id,
                partner_organization_id=UUID(partner_org_id) if partner_org_id else None,
                email=email,
                password_hash=hash_password(password),
                first_name="Partner",
                last_name="Manager",
                role="partner_manager",
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _orphan_body(partner_id: str, **extra: object) -> dict[str, object]:
    suffix = uuid4().hex[:6]
    return {
        "first_name": f"يتيم-{suffix}",
        "family_name": "اختبار",
        "date_of_birth": "2015-04-01",
        "gender": "M",
        "partner_organization_id": partner_id,
        "father_name": f"أب-{suffix}",
        **extra,
    }


async def _create_orphan(
    api: AsyncClient, headers: dict[str, str], partner_id: str
) -> dict[str, Any]:
    r = await api.post("/api/v1/orphans", json=_orphan_body(partner_id), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def _create_dar(api: AsyncClient, headers: dict[str, str], partner_id: str) -> dict[str, Any]:
    suffix = uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphanages",
        json={
            "name_ar": f"دار-{suffix}",
            "name_en": f"Dar {suffix}",
            "partner_organization_id": partner_id,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _scenario(api: AsyncClient, auth_headers: dict[str, str]) -> dict[str, Any]:
    """Two جهات (A, B) in the same DEV org, each with one orphan and one dar.

    All rows are created by the seeded org_admin (``auth_headers``); the جهة
    split is purely on ``partner_organization_id``.
    """
    org_id = await _seed_org_id()
    jiha_a = await _make_partner_org(org_id)
    jiha_b = await _make_partner_org(org_id)
    return {
        "org_id": org_id,
        "jiha_a": jiha_a,
        "jiha_b": jiha_b,
        "orphan_a": await _create_orphan(api, auth_headers, jiha_a),
        "orphan_b": await _create_orphan(api, auth_headers, jiha_b),
        "dar_a": await _create_dar(api, auth_headers, jiha_a),
        "dar_b": await _create_dar(api, auth_headers, jiha_b),
    }


async def test_partner_manager_list_scoped_to_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A partner_manager in جهة A sees only جهة A's orphans and dars in the
    lists — never جهة B's."""
    s = await _scenario(api, auth_headers)
    pm = await _login_partner_manager(api, s["org_id"], s["jiha_a"])

    r = await api.get("/api/v1/orphans?limit=100", headers=pm)
    assert r.status_code == 200, r.text
    orphans = r.json()["items"]
    ids = {o["id"] for o in orphans}
    assert s["orphan_a"]["id"] in ids
    assert s["orphan_b"]["id"] not in ids
    # The strongest "only A" guard: nothing outside جهة A ever surfaces.
    assert all(o["partner_organization_id"] == s["jiha_a"] for o in orphans)

    r = await api.get("/api/v1/orphanages?limit=100", headers=pm)
    assert r.status_code == 200, r.text
    dars = r.json()["items"]
    dar_ids = {d["id"] for d in dars}
    assert s["dar_a"]["id"] in dar_ids
    assert s["dar_b"]["id"] not in dar_ids
    assert all(d["partner_organization_id"] == s["jiha_a"] for d in dars)


async def test_partner_manager_detail_scoped_to_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Detail of an own-جهة row is 200; a row in another جهة 404s (its
    existence must not leak)."""
    s = await _scenario(api, auth_headers)
    pm = await _login_partner_manager(api, s["org_id"], s["jiha_a"])

    r = await api.get(f"/api/v1/orphans/{s['orphan_a']['id']}", headers=pm)
    assert r.status_code == 200, r.text
    assert r.json()["partner_organization_id"] == s["jiha_a"]

    r = await api.get(f"/api/v1/orphans/{s['orphan_b']['id']}", headers=pm)
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/orphanages/{s['dar_a']['id']}", headers=pm)
    assert r.status_code == 200, r.text

    r = await api.get(f"/api/v1/orphanages/{s['dar_b']['id']}", headers=pm)
    assert r.status_code == 404, r.text


async def test_partner_manager_csv_scoped_to_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The CSV export mirrors the list: only جهة A's codes appear."""
    s = await _scenario(api, auth_headers)
    pm = await _login_partner_manager(api, s["org_id"], s["jiha_a"])

    r = await api.get("/api/v1/orphans/export.csv", headers=pm)
    assert r.status_code == 200, r.text
    codes = {row["code"] for row in csv.DictReader(io.StringIO(r.text))}
    assert s["orphan_a"]["code"] in codes
    assert s["orphan_b"]["code"] not in codes


async def test_null_jiha_scoped_user_sees_nothing(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A partner-scoped user with no جهة set sees empty lists/CSV, and every
    real row 404s for them."""
    s = await _scenario(api, auth_headers)
    pm = await _login_partner_manager(api, s["org_id"], None)

    r = await api.get("/api/v1/orphans?limit=100", headers=pm)
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0
    assert r.json()["items"] == []

    r = await api.get("/api/v1/orphanages?limit=100", headers=pm)
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0
    assert r.json()["items"] == []

    r = await api.get("/api/v1/orphans/export.csv", headers=pm)
    assert r.status_code == 200, r.text
    assert list(csv.DictReader(io.StringIO(r.text))) == []

    r = await api.get(f"/api/v1/orphans/{s['orphan_a']['id']}", headers=pm)
    assert r.status_code == 404, r.text
    r = await api.get(f"/api/v1/orphanages/{s['dar_a']['id']}", headers=pm)
    assert r.status_code == 404, r.text


async def test_partner_manager_patch_attach_dar_scoped_to_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PATCH may attach a dar only inside the caller's جهة: a جهة-B dar is
    rejected, a جهة-A dar succeeds."""
    s = await _scenario(api, auth_headers)
    pm = await _login_partner_manager(api, s["org_id"], s["jiha_a"])

    # Cross-جهة dar → rejected; the orphan stays unassigned.
    r = await api.patch(
        f"/api/v1/orphans/{s['orphan_a']['id']}",
        json={"orphanage_id": s["dar_b"]["id"]},
        headers=pm,
    )
    assert r.status_code in (400, 404), r.text
    after = await api.get(f"/api/v1/orphans/{s['orphan_a']['id']}", headers=pm)
    assert after.json()["orphanage_id"] is None

    # Own-جهة dar → accepted.
    r = await api.patch(
        f"/api/v1/orphans/{s['orphan_a']['id']}",
        json={"orphanage_id": s["dar_a"]["id"]},
        headers=pm,
    )
    assert r.status_code == 200, r.text
    assert r.json()["orphanage_id"] == s["dar_a"]["id"]


async def test_partner_manager_patch_foreign_jiha_orphan_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A partner_manager cannot modify an orphan in another جهة: the write path
    404s (existence stays hidden, mirroring the detail GET) and nothing is
    written."""
    s = await _scenario(api, auth_headers)
    pm = await _login_partner_manager(api, s["org_id"], s["jiha_a"])

    r = await api.patch(
        f"/api/v1/orphans/{s['orphan_b']['id']}",
        json={"aspiration": "محاولة تعديل"},
        headers=pm,
    )
    assert r.status_code == 404, r.text
    # The foreign orphan was left untouched (read back as the org_admin).
    after = await api.get(f"/api/v1/orphans/{s['orphan_b']['id']}", headers=auth_headers)
    assert after.json()["aspiration"] != "محاولة تعديل"


async def test_org_admin_unaffected_by_partner_scope(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """org_admin keeps full org-level reach: it sees both جهات, reads either,
    and may attach a dar from any جهة in its org (org-level check, unchanged)."""
    s = await _scenario(api, auth_headers)

    r = await api.get("/api/v1/orphans?limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    ids = {o["id"] for o in r.json()["items"]}
    assert {s["orphan_a"]["id"], s["orphan_b"]["id"]} <= ids

    r = await api.get(f"/api/v1/orphans/{s['orphan_b']['id']}", headers=auth_headers)
    assert r.status_code == 200, r.text

    r = await api.get("/api/v1/orphanages?limit=100", headers=auth_headers)
    assert r.status_code == 200, r.text
    dar_ids = {d["id"] for d in r.json()["items"]}
    assert {s["dar_a"]["id"], s["dar_b"]["id"]} <= dar_ids

    # A dar in جهة B can be attached to an orphan in جهة A — partner scoping
    # never constrains an org admin.
    r = await api.patch(
        f"/api/v1/orphans/{s['orphan_a']['id']}",
        json={"orphanage_id": s["dar_b"]["id"]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["orphanage_id"] == s["dar_b"]["id"]
