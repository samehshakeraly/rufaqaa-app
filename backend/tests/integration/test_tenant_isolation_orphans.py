"""Cross-tenant (multi-tenant) isolation for the orphans + media routers.

The app connects to Postgres as a SUPERUSER, which BYPASSES Row-Level
Security, so every query over tenant-owned data must filter by
``organization_id`` EXPLICITLY in code. These tests stand up two
organizations — each with its own جهة (partner org), orphan and media row —
and prove that an org-A admin can neither list nor reach org-B's orphans or
media: lists/exports show only A, and every fetch/mutation of a B row returns
404 (never 403/200), so the row's existence is never leaked. A positive
in-org baseline guards against a blanket break being mistaken for isolation.

These mirror :mod:`tests.integration.test_tenant_isolation` (families /
partners) and, like the rest of ``tests/integration``, need a real Postgres
with the migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they
skip. They deliberately insert media rows directly (non-``s3://`` URLs) so the
media isolation assertions never touch object storage — the org filter is
enforced before any presigning, so a cross-org id 404s without S3.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.user import User


async def _make_org() -> UUID:
    """Create a fresh, isolated organization and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"TIO-{suffix[:6].upper()}",
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


async def _make_partner(org_id: UUID) -> str:
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
        return str(partner.id)


async def _make_orphan(org_id: UUID, partner_id: str) -> tuple[str, str]:
    """Create an orphan in ``org_id``/``partner_id``; return (id, code).

    Lands in the default ``pending_review`` case_status, so the approve/reject
    transitions are reachable — proving the cross-org 404 fires *before* any
    state check (never leaking case_status either)."""
    suffix = uuid.uuid4().hex[:6]
    code = f"ORF-{suffix}"
    async with make_session() as db:
        orphan = Orphan(
            organization_id=org_id,
            partner_organization_id=UUID(partner_id),
            code=code,
            first_name=f"يتيم-{suffix}",
            family_name="عزل",
            date_of_birth=date(2015, 3, 14),
            gender="F",
        )
        db.add(orphan)
        await db.commit()
        await db.refresh(orphan)
        return str(orphan.id), code


async def _insert_media(org_id: UUID, orphan_id: str, *, moderation_status: str = "pending") -> str:
    """Insert a media row directly (no S3) and return its id.

    Uses an ``https://`` (non-``s3://``) URL so list/presigned-url read-backs
    return it verbatim without contacting object storage."""
    media_id = uuid.uuid4()
    async with make_session() as db:
        await db.execute(
            text(
                """
                INSERT INTO media
                    (id, organization_id, orphan_id, media_type, file_url,
                     moderation_status, visibility, created_at)
                VALUES
                    (:id, :org, :orphan, 'photo', :url, :status, 'private', NOW())
                """
            ),
            {
                "id": str(media_id),
                "org": str(org_id),
                "orphan": orphan_id,
                "url": f"https://example.test/{media_id.hex}.jpg",
                "status": moderation_status,
            },
        )
        await db.commit()
    return str(media_id)


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


async def test_orphans_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A admin sees only org A's orphan and 404s on every org-B route."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a, code_a = await _make_orphan(org_a, partner_a)
    orphan_b, _code_b = await _make_orphan(org_b, partner_b)

    headers_a = await _login_as(api, org_a, "org_admin")

    # GET /orphans lists only org A's orphan — org B never bleeds in.
    r = await api.get("/api/v1/orphans?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    ids = {o["id"] for o in r.json()["items"]}
    assert ids == {orphan_a}
    assert orphan_b not in ids

    # CSV export is scoped too: a single data row (org A's orphan), B absent.
    r = await api.get("/api/v1/orphans/export.csv", headers=headers_a)
    assert r.status_code == 200, r.text
    csv_rows = list(csv.DictReader(io.StringIO(r.text)))
    assert {row["code"] for row in csv_rows} == {code_a}

    # Baseline: org A reaches its own orphan, so the 404s below are org-scoping,
    # not a blanket break.
    r = await api.get(f"/api/v1/orphans/{orphan_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    # Every cross-org fetch/mutation 404s — never 200/403, never leaking the row.
    r = await api.get(f"/api/v1/orphans/{orphan_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.patch(
        f"/api/v1/orphans/{orphan_b}",
        json={"first_name": "محاولة"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    r = await api.post(
        f"/api/v1/orphans/{orphan_b}/assign-channel",
        json={"channel_id": None},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    # The case-status workflow 404s before the state check, so case_status never leaks.
    r = await api.post(f"/api/v1/orphans/{orphan_b}/approve", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.post(
        f"/api/v1/orphans/{orphan_b}/reject",
        json={"reason": "محاولة"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    r = await api.post(f"/api/v1/orphans/{orphan_b}/release", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/orphans/{orphan_b}/timeline", headers=headers_a)
    assert r.status_code == 404, r.text

    # DELETE last — a cross-org id must not soft-delete another org's orphan.
    r = await api.delete(f"/api/v1/orphans/{orphan_b}", headers=headers_a)
    assert r.status_code == 404, r.text


async def test_orphan_media_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A admin cannot read, presign or moderate org B's orphan media."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a, _ = await _make_orphan(org_a, partner_a)
    orphan_b, _ = await _make_orphan(org_b, partner_b)
    media_a = await _insert_media(org_a, orphan_a)
    media_b = await _insert_media(org_b, orphan_b)

    headers_a = await _login_as(api, org_a, "org_admin")

    # ── Cross-org reads/mutations all 404 (existence never leaks). ──
    # Upload to org B's orphan 404s on the org guard, before any S3 call.
    files = {"file": ("x.jpg", b"\xff\xd8\xff\xe0", "image/jpeg")}
    r = await api.post(f"/api/v1/media/orphans/{orphan_b}/photo", files=files, headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/media/orphans/{orphan_b}/photos", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.get(f"/api/v1/media/{media_b}/url", headers=headers_a)
    assert r.status_code == 404, r.text

    r = await api.post(
        f"/api/v1/media/{media_b}/moderate",
        json={"decision": "approve"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    # ── In-org baseline: org A reaches its own orphan's media. ──
    r = await api.get(f"/api/v1/media/orphans/{orphan_a}/photos", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {p["id"] for p in r.json()} == {media_a}

    r = await api.get(f"/api/v1/media/{media_a}/url", headers=headers_a)
    assert r.status_code == 200, r.text

    # Moderate last — it mutates the row. In-org succeeds.
    r = await api.post(
        f"/api/v1/media/{media_a}/moderate",
        json={"decision": "approve"},
        headers=headers_a,
    )
    assert r.status_code == 200, r.text
