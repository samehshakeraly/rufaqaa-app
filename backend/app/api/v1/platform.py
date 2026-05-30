"""Super-admin platform (cross-org) API — B-6.

Every endpoint here is **platform-level**: it reads and writes across ALL
organizations, intentionally bypassing the per-tenant Row-Level Security
that scopes the rest of the API. Tenant isolation is enforced elsewhere
by the `app.current_org_id` GUC + RLS policies; these endpoints sit
*above* that boundary and never apply an org filter.

Two facts make the bypass safe and correct:

  1. The `organizations` and `platform_settings` tables carry no RLS
     policy, so cross-org reads/writes on them need nothing special.
  2. Aggregates over tenant tables (orphans / donors / sponsorships /
     payments) are read with NO `app.current_org_id` filter; the
     super_admin DB context is privileged to see every org's rows.

ALL routes are gated with `require_roles("super_admin")`. `org_admin`
is part of ADMIN_ROLES but is strictly per-org and MUST NOT reach these
endpoints — every handler depends on the super-admin-only guard below.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.core.authz import require_roles
from app.core.exceptions import NotFound
from app.core.security import hash_password
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.platform_settings import PlatformSettings
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.platform import (
    CreatedAdmin,
    PlatformOrgCreate,
    PlatformOrgCreateResponse,
    PlatformOrgDetail,
    PlatformOrgSummary,
    PlatformOrgUpdate,
    PlatformSettingsRead,
    PlatformSettingsUpdate,
    SuspendRequest,
)
from app.services.audit import record_audit

router = APIRouter()

# Super-admin-only guard reused by every route in this module. NOTE: this
# is deliberately NOT ADMIN_ROLES — org_admin must get 403 here.
SuperAdmin = Annotated[User, Depends(require_roles("super_admin"))]


# ── helpers ──────────────────────────────────────────────────────────


async def _counts_for(db: DbSession, org_id: UUID) -> tuple[int, int, int]:
    """(orphans, donors, sponsorships) for a single org. Cross-org safe:
    filtered by the explicit org_id argument, not by RLS."""
    orphans = await db.scalar(
        select(func.count(Orphan.id)).where(
            Orphan.organization_id == org_id, Orphan.deleted_at.is_(None)
        )
    )
    donors = await db.scalar(
        select(func.count(Donor.id)).where(
            Donor.organization_id == org_id, Donor.deleted_at.is_(None)
        )
    )
    sponsorships = await db.scalar(
        select(func.count(Sponsorship.id)).where(Sponsorship.organization_id == org_id)
    )
    return int(orphans or 0), int(donors or 0), int(sponsorships or 0)


def _detail(org: Organization, counts: tuple[int, int, int]) -> PlatformOrgDetail:
    return PlatformOrgDetail.model_validate(org).model_copy(
        update={
            "total_orphans": counts[0],
            "total_donors": counts[1],
            "total_sponsorships": counts[2],
        }
    )


async def _get_org_or_404(db: DbSession, org_id: UUID) -> Organization:
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    if org is None:
        raise NotFound("Organization")
    return org


# ── organizations ────────────────────────────────────────────────────


@router.get("/organizations", response_model=list[PlatformOrgSummary])
async def list_organizations(
    db: DbSession,
    _admin: SuperAdmin,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    country: str | None = None,
    search: str | None = None,
) -> list[PlatformOrgSummary]:
    """List ALL organizations across the platform (no org filter — this
    is an intentional cross-tenant read gated to super_admin). Tenant
    counts are joined in via grouped subqueries to avoid N+1."""
    orphan_counts = (
        select(Orphan.organization_id.label("org_id"), func.count(Orphan.id).label("c"))
        .where(Orphan.deleted_at.is_(None))
        .group_by(Orphan.organization_id)
        .subquery()
    )
    donor_counts = (
        select(Donor.organization_id.label("org_id"), func.count(Donor.id).label("c"))
        .where(Donor.deleted_at.is_(None))
        .group_by(Donor.organization_id)
        .subquery()
    )
    sponsorship_counts = (
        select(
            Sponsorship.organization_id.label("org_id"),
            func.count(Sponsorship.id).label("c"),
        )
        .group_by(Sponsorship.organization_id)
        .subquery()
    )

    stmt = (
        select(
            Organization,
            func.coalesce(orphan_counts.c.c, 0),
            func.coalesce(donor_counts.c.c, 0),
            func.coalesce(sponsorship_counts.c.c, 0),
        )
        .outerjoin(orphan_counts, orphan_counts.c.org_id == Organization.id)
        .outerjoin(donor_counts, donor_counts.c.org_id == Organization.id)
        .outerjoin(sponsorship_counts, sponsorship_counts.c.org_id == Organization.id)
    )
    if status_filter:
        stmt = stmt.where(Organization.status == status_filter)
    if country:
        stmt = stmt.where(Organization.country_code == country.upper())
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            Organization.name_ar.ilike(like)
            | Organization.name_en.ilike(like)
            | Organization.code.ilike(like)
        )
    stmt = stmt.order_by(Organization.created_at.desc())

    rows = (await db.execute(stmt)).all()
    return [
        PlatformOrgSummary.model_validate(org).model_copy(
            update={
                "total_orphans": int(o_c),
                "total_donors": int(d_c),
                "total_sponsorships": int(s_c),
            }
        )
        for org, o_c, d_c, s_c in rows
    ]


@router.get("/organizations/{org_id}", response_model=PlatformOrgDetail)
async def get_organization(org_id: UUID, db: DbSession, _admin: SuperAdmin) -> PlatformOrgDetail:
    """Full detail for any org on the platform (cross-tenant read)."""
    org = await _get_org_or_404(db, org_id)
    return _detail(org, await _counts_for(db, org_id))


@router.post(
    "/organizations",
    response_model=PlatformOrgCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_organization(
    payload: PlatformOrgCreate, db: DbSession, admin: SuperAdmin
) -> PlatformOrgCreateResponse:
    """Provision a brand-new tenant org plus its initial org_admin user.

    Cross-tenant write: the new org and its admin belong to a different
    tenant than the calling super_admin, which is exactly the point.
    Conflicts on org code / admin email return 409 rather than a 500.
    """
    if await db.scalar(select(Organization.id).where(Organization.code == payload.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Organization code already exists")
    if await db.scalar(select(User.id).where(User.email == payload.admin_email)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Admin email already in use")

    org = Organization(
        code=payload.code,
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        country_code=payload.country_code.upper(),
        default_currency=payload.default_currency.upper(),
        org_type=payload.org_type,
        deployment_mode=payload.deployment_mode,
        created_by=admin.id,
    )
    db.add(org)
    await db.flush()

    org_admin = User(
        organization_id=org.id,
        email=str(payload.admin_email),
        password_hash=hash_password(payload.admin_password),
        first_name=payload.admin_first_name,
        last_name=payload.admin_last_name,
        role="org_admin",
        status="active",
    )
    db.add(org_admin)
    await db.flush()

    record_audit(
        db,
        organization_id=org.id,
        user_id=admin.id,
        action="platform.organization.created",
        entity_type="organization",
        entity_id=org.id,
        new_values={
            "code": org.code,
            "name_en": org.name_en,
            "org_admin_email": org_admin.email,
        },
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(org)

    detail = _detail(org, (0, 0, 0))
    return PlatformOrgCreateResponse(
        organization=detail,
        admin_user=CreatedAdmin(id=org_admin.id, email=org_admin.email),
    )


@router.patch("/organizations/{org_id}", response_model=PlatformOrgDetail)
async def update_organization(
    org_id: UUID, payload: PlatformOrgUpdate, db: DbSession, admin: SuperAdmin
) -> PlatformOrgDetail:
    """Platform-level edit of any org (status, plan, expiry, settings).
    Cross-tenant write gated to super_admin."""
    org = await _get_org_or_404(db, org_id)

    changes: dict[str, dict[str, Any]] = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(org, field)
        if old != value:
            changes[field] = {"old": _audit_val(old), "new": _audit_val(value)}
            setattr(org, field, value)

    if changes:
        record_audit(
            db,
            organization_id=org.id,
            user_id=admin.id,
            action="platform.organization.updated",
            entity_type="organization",
            entity_id=org.id,
            old_values={k: v["old"] for k, v in changes.items()},
            new_values={k: v["new"] for k, v in changes.items()},
        )
    await db.commit()
    await db.refresh(org)
    return _detail(org, await _counts_for(db, org_id))


@router.post("/organizations/{org_id}/suspend", response_model=PlatformOrgDetail)
async def suspend_organization(
    org_id: UUID, payload: SuspendRequest, db: DbSession, admin: SuperAdmin
) -> PlatformOrgDetail:
    """Suspend an org (status=suspended) and record the reason in
    settings.suspension. Cross-tenant write gated to super_admin."""
    org = await _get_org_or_404(db, org_id)
    old_status = org.status
    org.status = "suspended"
    org.settings = {
        **(org.settings or {}),
        "suspension": {
            "reason": payload.reason,
            "at": datetime.now(UTC).isoformat(),
            "by": str(admin.id),
        },
    }
    record_audit(
        db,
        organization_id=org.id,
        user_id=admin.id,
        action="platform.organization.suspended",
        entity_type="organization",
        entity_id=org.id,
        old_values={"status": old_status},
        new_values={"status": "suspended", "reason": payload.reason},
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(org)
    return _detail(org, await _counts_for(db, org_id))


@router.post("/organizations/{org_id}/activate", response_model=PlatformOrgDetail)
async def activate_organization(
    org_id: UUID, db: DbSession, admin: SuperAdmin
) -> PlatformOrgDetail:
    """Re-activate a suspended org (status=active) and clear the stored
    suspension reason. Cross-tenant write gated to super_admin."""
    org = await _get_org_or_404(db, org_id)
    old_status = org.status
    org.status = "active"
    if org.settings and "suspension" in org.settings:
        new_settings = dict(org.settings)
        new_settings.pop("suspension", None)
        org.settings = new_settings
    record_audit(
        db,
        organization_id=org.id,
        user_id=admin.id,
        action="platform.organization.activated",
        entity_type="organization",
        entity_id=org.id,
        old_values={"status": old_status},
        new_values={"status": "active"},
    )
    await db.commit()
    await db.refresh(org)
    return _detail(org, await _counts_for(db, org_id))


# ── platform settings (singleton) ────────────────────────────────────


async def _settings_row(db: DbSession) -> PlatformSettings:
    row = await db.scalar(select(PlatformSettings).where(PlatformSettings.id == 1))
    if row is None:
        # Migration 0007 seeds id=1, but be defensive if it's missing.
        row = PlatformSettings(id=1, settings={})
        db.add(row)
        await db.flush()
    return row


@router.get("/settings", response_model=PlatformSettingsRead)
async def get_platform_settings(db: DbSession, _admin: SuperAdmin) -> PlatformSettingsRead:
    """Read the system-wide flags (maintenance_mode, signups_open, …).
    Singleton row, no tenant scope."""
    row = await _settings_row(db)
    return PlatformSettingsRead(
        settings=row.settings or {}, updated_at=row.updated_at, updated_by=row.updated_by
    )


@router.patch("/settings", response_model=PlatformSettingsRead)
async def update_platform_settings(
    payload: PlatformSettingsUpdate, db: DbSession, admin: SuperAdmin
) -> PlatformSettingsRead:
    """Shallow-merge the provided keys into the platform settings JSONB.
    Gated to super_admin."""
    row = await _settings_row(db)
    merged = {**(row.settings or {}), **payload.settings}
    row.settings = merged
    row.updated_by = admin.id
    record_audit(
        db,
        organization_id=admin.organization_id,
        user_id=admin.id,
        action="platform.settings.updated",
        entity_type="platform_settings",
        new_values={"keys": sorted(payload.settings.keys())},
    )
    await db.commit()
    await db.refresh(row)
    return PlatformSettingsRead(
        settings=row.settings or {}, updated_at=row.updated_at, updated_by=row.updated_by
    )


def _audit_val(v: Any) -> str | None:
    return None if v is None else str(v)
