"""PR-2 — partner-scoped visibility for orphanages & orphans (read-only).

A ``partner_manager`` / ``partner_staff`` sees only their own جهة's dars and
orphans; a partner user with no جهة (NULL) sees nothing (empty lists, 404 on
detail); ``org_admin`` visibility is unchanged. Detail endpoints return 404
(not 403) for an out-of-scope row so existence isn't leaked.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. They
build two جهات under the seeded DEV org.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.partner import PartnerOrganization
from app.models.user import User

_PASSWORD = "scopedpass123"


async def _login(api: AsyncClient, email: str) -> dict[str, str]:
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": _PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _setup(api: AsyncClient) -> dict[str, str]:
    """Two جهات (A, B) under the DEV org, each with a dar + orphan, plus a
    partner_manager scoped to جهة A and a partner_staff with no جهة."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        org_id = await db.scalar(
            text("SELECT id::text FROM organizations WHERE code = 'DEV' LIMIT 1")
        )
        partner_a = await db.scalar(
            text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
        )
        assert org_id and partner_a
        await db.execute(text("SELECT set_config('app.current_org_id', :v, true)"), {"v": org_id})

        partner_b = PartnerOrganization(
            organization_id=uuid.UUID(org_id),
            code=f"PTN-B-{suffix}",
            name_ar="جهة ب",
            country_code="KW",
            status="active",
        )
        db.add(partner_b)
        await db.flush()

        dar_a = Orphanage(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=uuid.UUID(partner_a),
            code=f"DAR-A{suffix.upper()}",
            name_ar="دار أ",
            name_en="Dar A",
            country_code="KW",
        )
        dar_b = Orphanage(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=partner_b.id,
            code=f"DAR-B{suffix.upper()}",
            name_ar="دار ب",
            name_en="Dar B",
            country_code="KW",
        )
        # Suffix the identity fields so repeated _setup calls don't trip the
        # (org, name, dob, father) no-duplicate index.
        orphan_a = Orphan(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=uuid.UUID(partner_a),
            code=f"ORF-A{suffix.upper()}",
            first_name=f"يتيم-أ-{suffix}",
            family_name="أ",
            date_of_birth=date(2015, 1, 1),
            gender="M",
            father_name=f"أب-{suffix}",
        )
        orphan_b = Orphan(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=partner_b.id,
            code=f"ORF-B{suffix.upper()}",
            first_name=f"يتيم-ب-{suffix}",
            family_name="ب",
            date_of_birth=date(2015, 2, 2),
            gender="F",
            father_name=f"أب-{suffix}",
        )
        pm_email = f"pm-{suffix}@dev.rufaqaa.app"
        staff_email = f"ps-{suffix}@dev.rufaqaa.app"
        pm = User(
            organization_id=uuid.UUID(org_id),
            email=pm_email,
            password_hash=hash_password(_PASSWORD),
            first_name="Partner",
            last_name="Manager",
            role="partner_manager",
            partner_organization_id=uuid.UUID(partner_a),
        )
        staff = User(
            organization_id=uuid.UUID(org_id),
            email=staff_email,
            password_hash=hash_password(_PASSWORD),
            first_name="Partner",
            last_name="Staff",
            role="partner_staff",
        )
        db.add_all([dar_a, dar_b, orphan_a, orphan_b, pm, staff])
        await db.commit()

        return {
            "dar_a": str(dar_a.id),
            "dar_b": str(dar_b.id),
            "orphan_a": str(orphan_a.id),
            "orphan_b": str(orphan_b.id),
            "orphan_a_code": orphan_a.code,
            "orphan_b_code": orphan_b.code,
            "pm_email": pm_email,
            "staff_email": staff_email,
        }


def _csv_codes(body: str) -> list[str]:
    """The ``code`` column (first) of each data row in a CSV export body."""
    rows = list(csv.reader(io.StringIO(body)))
    return [r[0] for r in rows[1:] if r]  # skip header; drop any blank trailing row


async def test_partner_manager_sees_only_own_jiha(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ids = await _setup(api)
    pm = await _login(api, ids["pm_email"])

    dars = (await api.get("/api/v1/orphanages?limit=100", headers=pm)).json()["items"]
    dar_ids = {d["id"] for d in dars}
    assert ids["dar_a"] in dar_ids
    assert ids["dar_b"] not in dar_ids

    orphans = (await api.get("/api/v1/orphans?limit=100", headers=pm)).json()["items"]
    orphan_ids = {o["id"] for o in orphans}
    assert ids["orphan_a"] in orphan_ids
    assert ids["orphan_b"] not in orphan_ids

    # Own جهة → 200; other جهة → 404 (not 403 — existence stays hidden).
    assert (await api.get(f"/api/v1/orphanages/{ids['dar_a']}", headers=pm)).status_code == 200
    assert (await api.get(f"/api/v1/orphanages/{ids['dar_b']}", headers=pm)).status_code == 404
    assert (await api.get(f"/api/v1/orphans/{ids['orphan_a']}", headers=pm)).status_code == 200
    assert (await api.get(f"/api/v1/orphans/{ids['orphan_b']}", headers=pm)).status_code == 404


async def test_unassigned_partner_user_sees_nothing(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ids = await _setup(api)
    staff = await _login(api, ids["staff_email"])

    assert (await api.get("/api/v1/orphanages?limit=100", headers=staff)).json()["total"] == 0
    assert (await api.get("/api/v1/orphans?limit=100", headers=staff)).json()["total"] == 0
    assert (await api.get(f"/api/v1/orphanages/{ids['dar_a']}", headers=staff)).status_code == 404
    assert (await api.get(f"/api/v1/orphans/{ids['orphan_a']}", headers=staff)).status_code == 404


async def test_org_admin_visibility_unchanged(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    ids = await _setup(api)

    dars = (await api.get("/api/v1/orphanages?limit=100", headers=auth_headers)).json()["items"]
    assert {ids["dar_a"], ids["dar_b"]} <= {d["id"] for d in dars}

    orphans = (await api.get("/api/v1/orphans?limit=100", headers=auth_headers)).json()["items"]
    assert {ids["orphan_a"], ids["orphan_b"]} <= {o["id"] for o in orphans}

    # org_admin sees the other جهة's detail too (unchanged behaviour).
    assert (
        await api.get(f"/api/v1/orphanages/{ids['dar_b']}", headers=auth_headers)
    ).status_code == 200
    assert (
        await api.get(f"/api/v1/orphans/{ids['orphan_b']}", headers=auth_headers)
    ).status_code == 200


async def test_csv_export_is_partner_scoped(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """The CSV export is the same visibility surface as the list — it must obey
    the same org + partner scoping, not become a back door around it."""
    ids = await _setup(api)
    pm = await _login(api, ids["pm_email"])
    staff = await _login(api, ids["staff_email"])

    # partner_manager (جهة A): export carries A's orphan, never B's.
    pm_codes = _csv_codes((await api.get("/api/v1/orphans/export.csv", headers=pm)).text)
    assert ids["orphan_a_code"] in pm_codes
    assert ids["orphan_b_code"] not in pm_codes

    # Unassigned partner user: header only, zero data rows.
    staff_csv = (await api.get("/api/v1/orphans/export.csv", headers=staff)).text
    assert _csv_codes(staff_csv) == []

    # org_admin: both جهات present (unchanged).
    admin_codes = _csv_codes(
        (await api.get("/api/v1/orphans/export.csv", headers=auth_headers)).text
    )
    assert {ids["orphan_a_code"], ids["orphan_b_code"]} <= set(admin_codes)
