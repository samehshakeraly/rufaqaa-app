from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.api.v1.orphans import ReportsCadence, SegmentBucket, _breakdown_buckets
from app.core.authz import (
    PARTNER_SCOPED_ROLES,
    STAFF_ROLES,
    partner_scope_hides,
    require_roles,
)
from app.core.constants import FILE_INCOMPLETE_THRESHOLD, REPORT_OVERDUE_GRACE_DAYS
from app.core.exceptions import NotFound
from app.core.reporting import due_status_cutoffs, effective_cadence
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.report import OrphanReport
from app.models.user import User
from app.schemas.common import Page
from app.schemas.orphanage import (
    OrphanageCreate,
    OrphanageRead,
    OrphanageUpdate,
)
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


async def _assert_user_can_manage(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    *,
    exclude_orphanage_id: UUID | None = None,
) -> None:
    """Validate that ``user_id`` may be assigned as a dar's manager.

    Mirrors the org-scoped validation in ``services/orphans._assert_orphanage_in_org``:
    we check explicitly (400) rather than trusting RLS — a Postgres superuser
    connection bypasses it. Two rules:

    * the user must exist, belong to ``organization_id`` and be an
      ``orphanage_manager`` (the role 0011 introduced);
    * the user must not already manage a *different* dar. The DB enforces this
      with a UNIQUE constraint on ``manager_user_id``; pre-checking here turns
      its raw 409 unique-violation into a clean 400. ``exclude_orphanage_id``
      lets an update re-assert the dar's own current manager without tripping.
    """
    manager = await db.scalar(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
        )
    )
    if manager is None or manager.role != "orphanage_manager":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="manager_user_id must reference an orphanage_manager in this organization",
        )

    stmt = select(Orphanage.id).where(Orphanage.manager_user_id == user_id)
    if exclude_orphanage_id is not None:
        stmt = stmt.where(Orphanage.id != exclude_orphanage_id)
    if (await db.scalar(stmt)) is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user already manages another orphanage",
        )


# NOTE: every query below scopes to user.organization_id EXPLICITLY rather
# than leaning on the orphanages_org_isolation RLS policy alone. This is a
# deliberate departure from the families template: a Postgres superuser
# connection bypasses RLS unconditionally (the posture of the CI / test DB),
# so RLS-only endpoints leak across orgs in that environment. The explicit
# filter is defense-in-depth — redundant-but-harmless when RLS is in force,
# the real guard when it is bypassed.


@router.get("", response_model=Page[OrphanageRead])
async def list_orphanages(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[OrphanageRead]:
    stmt = select(Orphanage).where(Orphanage.organization_id == user.organization_id)
    # Partner-scoped roles (partner_manager / partner_staff) see only their own
    # جهة's dars — layered on the org filter, never via RLS. A scoped user with
    # no جهة set sees nothing. Applied before the count so pagination matches.
    if user.role in PARTNER_SCOPED_ROLES:
        if user.partner_organization_id is None:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(Orphanage.partner_organization_id == user.partner_organization_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Orphanage.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[OrphanageRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=OrphanageRead, status_code=status.HTTP_201_CREATED)
async def create_orphanage(
    payload: OrphanageCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> OrphanageRead:
    if payload.manager_user_id is not None:
        await _assert_user_can_manage(db, payload.manager_user_id, user.organization_id)
    orphanage = Orphanage(
        organization_id=user.organization_id,
        partner_organization_id=payload.partner_organization_id,
        code=generate_code("DAR"),
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        country_code=payload.country_code,
        governorate=payload.governorate,
        city=payload.city,
        district=payload.district,
        address_details=payload.address_details,
        status=payload.status,
        capacity=payload.capacity,
        notes=payload.notes,
        manager_user_id=payload.manager_user_id,
        created_by=user.id,
    )
    db.add(orphanage)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphanage.created",
        entity_type="orphanage",
        entity_id=orphanage.id,
        new_values={"code": orphanage.code, "name_ar": orphanage.name_ar},
    )
    await db.commit()
    await db.refresh(orphanage)
    return OrphanageRead.model_validate(orphanage)


# ── House report (GET /orphanages/{orphanage_id}/report) ────────────────
#
# Read-only aggregate over ONE dar: occupancy against capacity, collective
# health / education breakdowns, sponsorship coverage, file completion and
# the reporting-cadence tallies. Counts and averages only — it never returns
# an individual resident row, zero PII. Mirrors the /orphans/segments
# posture: response models colocated here, breakdown buckets reuse
# SegmentBucket ordered by count descending with a stable key tiebreak, and
# the top-line reporting model is the shared ReportsCadence (imported from
# orphans.py, same one-way direction) so this report and the community
# follow-up report can never drift apart on the cadence definitions.

# Who may read a dar's report: the staff roles plus the dar's own manager.
# orphanage_manager is not a STAFF_ROLES member (require_roles would 403 it),
# but this report IS the manager's surface — _load_orphanage_for_report pins
# them to the single dar they run, so the wider gate leaks nothing.
REPORT_VIEWER_ROLES: tuple[str, ...] = (*STAFF_ROLES, "orphanage_manager")


class OrphanageOccupancy(BaseModel):
    capacity: int | None  # NULL = capacity not recorded on the dar
    residents: int
    occupancy_pct: int | None  # only when capacity is recorded and > 0
    free: int | None  # capacity - residents; negative when over-capacity
    over: bool  # residents > capacity; always False without a capacity


class OrphanageSponsorshipCoverage(BaseModel):
    sponsored: int
    unsponsored: int
    sponsored_pct: int | None  # None when the dar has no residents


class OrphanageFileCompletion(BaseModel):
    avg_completion: int | None  # None when the dar has no residents
    incomplete_count: int  # residents below FILE_INCOMPLETE_THRESHOLD


class OrphanageReport(BaseModel):
    orphanage_id: UUID
    occupancy: OrphanageOccupancy
    health: list[SegmentBucket]
    education: list[SegmentBucket]
    sponsorship: OrphanageSponsorshipCoverage
    files: OrphanageFileCompletion
    reporting: ReportsCadence


async def _load_orphanage_for_report(db: AsyncSession, user: User, orphanage_id: UUID) -> Orphanage:
    """Resolve ``orphanage_id`` under the caller's visibility, or 404.

    Same shape as ``orphanage_self._load_orphanage_or_404``: every failure is
    a 404 so the endpoint never confirms that a dar outside the caller's
    reach exists. Org scope is explicit (a superuser DB connection bypasses
    RLS); an orphanage_manager is pinned to the single dar they run; a
    partner-scoped caller only sees dars of their own جهة.
    """
    orphanage = await db.scalar(
        select(Orphanage).where(
            Orphanage.id == orphanage_id,
            Orphanage.organization_id == user.organization_id,
        )
    )
    if orphanage is None:
        raise NotFound("Orphanage")
    if user.role == "orphanage_manager" and orphanage.manager_user_id != user.id:
        raise NotFound("Orphanage")
    if partner_scope_hides(user, orphanage.partner_organization_id):
        raise NotFound("Orphanage")
    return orphanage


@router.get("/{orphanage_id}/report", response_model=OrphanageReport)
async def orphanage_report(
    orphanage_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*REPORT_VIEWER_ROLES))],
) -> OrphanageReport:
    """Aggregate "house report" for one dar, built entirely from its
    residents and their reports.

    A resident is an orphan with ``orphanage_id == {orphanage_id}`` in the
    caller's org and not soft-deleted — ``orphanage_id IS NULL`` means a
    family placement, never a resident (the ``orphanage_self`` definition).
    Occupancy handles an unrecorded capacity gracefully: the percentage and
    free-bed figures are null and ``over`` is false, so the frontend can say
    "capacity not recorded" instead of inventing a denominator.
    """
    orphanage = await _load_orphanage_for_report(db, user, orphanage_id)

    resident_where = (
        Orphan.orphanage_id == orphanage.id,
        Orphan.organization_id == user.organization_id,
        Orphan.deleted_at.is_(None),
    )

    # One pass over the residents for every scalar aggregate: headcount,
    # sponsorship coverage and the two file-completion figures.
    totals = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(Orphan.case_status == "sponsored"),
                func.avg(Orphan.profile_completion_percentage),
                func.count().filter(
                    Orphan.profile_completion_percentage < FILE_INCOMPLETE_THRESHOLD
                ),
            ).where(*resident_where)
        )
    ).one()
    residents = int(totals[0])
    sponsored = int(totals[1])
    avg_completion = int(round(totals[2])) if totals[2] is not None else None
    incomplete_count = int(totals[3])

    health_rows = (
        await db.execute(
            select(Orphan.health_status, func.count())
            .where(*resident_where)
            .group_by(Orphan.health_status)
        )
    ).all()
    education_rows = (
        await db.execute(
            select(Orphan.education_stage, func.count())
            .where(*resident_where)
            .group_by(Orphan.education_stage)
        )
    ).all()

    # The caller's org sets the cadence the residents classify against.
    # Queried explicitly (the relationship is lazy="raise") and org-scoped
    # like everything else here.
    org = await db.scalar(select(Organization).where(Organization.id == user.organization_id))
    if org is None:
        raise NotFound("Organization")
    cadence = effective_cadence(org)
    on_track_floor, due_soon_floor = due_status_cutoffs(cadence, date.today())

    # Each resident's latest non-draft period_end, built once and LEFT-JOINed
    # so residents with no non-draft report carry NULL. Server-side only —
    # never returned per child. The three filters PARTITION the residents
    # exactly: NULL never matches the first two and overdue catches it
    # explicitly, so the tallies always sum to the headcount.
    latest_report = (
        select(
            OrphanReport.orphan_id.label("orphan_id"),
            func.max(OrphanReport.period_end).label("last_period_end"),
        )
        .where(
            OrphanReport.organization_id == user.organization_id,
            OrphanReport.status != "draft",
        )
        .group_by(OrphanReport.orphan_id)
        .subquery()
    )
    last_period_end = latest_report.c.last_period_end
    cadence_row = (
        await db.execute(
            select(
                func.count().filter(last_period_end >= on_track_floor),
                func.count().filter(
                    and_(
                        last_period_end < on_track_floor,
                        last_period_end >= due_soon_floor,
                    )
                ),
                func.count().filter(
                    or_(last_period_end.is_(None), last_period_end < due_soon_floor)
                ),
            )
            .select_from(Orphan)
            .outerjoin(latest_report, latest_report.c.orphan_id == Orphan.id)
            .where(*resident_where)
        )
    ).one()
    on_track, due_soon, overdue = (int(n) for n in cadence_row)

    capacity = orphanage.capacity
    return OrphanageReport(
        orphanage_id=orphanage.id,
        occupancy=OrphanageOccupancy(
            capacity=capacity,
            residents=residents,
            occupancy_pct=(
                round(residents * 100 / capacity) if capacity is not None and capacity > 0 else None
            ),
            free=capacity - residents if capacity is not None else None,
            over=capacity is not None and residents > capacity,
        ),
        health=_breakdown_buckets(list(health_rows)),
        education=_breakdown_buckets(list(education_rows)),
        sponsorship=OrphanageSponsorshipCoverage(
            sponsored=sponsored,
            unsponsored=residents - sponsored,
            sponsored_pct=round(sponsored * 100 / residents) if residents else None,
        ),
        files=OrphanageFileCompletion(
            avg_completion=avg_completion,
            incomplete_count=incomplete_count,
        ),
        reporting=ReportsCadence(
            cadence_days=cadence,
            grace_days=REPORT_OVERDUE_GRACE_DAYS,
            on_track=on_track,
            due_soon=due_soon,
            overdue=overdue,
        ),
    )


@router.get("/{orphanage_id}", response_model=OrphanageRead)
async def get_orphanage(
    orphanage_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> OrphanageRead:
    orphanage = await db.scalar(
        select(Orphanage).where(
            Orphanage.id == orphanage_id,
            Orphanage.organization_id == user.organization_id,
        )
    )
    if orphanage is None:
        raise NotFound("Orphanage")
    # Partner-scoped callers must not learn that a dar outside their جهة exists.
    if partner_scope_hides(user, orphanage.partner_organization_id):
        raise NotFound("Orphanage")
    return OrphanageRead.model_validate(orphanage)


@router.patch("/{orphanage_id}", response_model=OrphanageRead)
async def update_orphanage(
    orphanage_id: UUID,
    payload: OrphanageUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> OrphanageRead:
    orphanage = await db.scalar(
        select(Orphanage).where(
            Orphanage.id == orphanage_id,
            Orphanage.organization_id == user.organization_id,
        )
    )
    if orphanage is None:
        raise NotFound("Orphanage")
    updates = payload.model_dump(exclude_unset=True)
    # A present, non-null manager is validated before assignment; a present
    # null clears it (no check needed); an absent key leaves it untouched.
    if updates.get("manager_user_id") is not None:
        await _assert_user_can_manage(
            db,
            updates["manager_user_id"],
            user.organization_id,
            exclude_orphanage_id=orphanage.id,
        )
    for field, value in updates.items():
        setattr(orphanage, field, value)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphanage.updated",
        entity_type="orphanage",
        entity_id=orphanage.id,
        # mode="json" keeps the audit JSONB-safe now that an updatable field
        # (manager_user_id) is a UUID rather than a plain string.
        new_values=payload.model_dump(exclude_unset=True, mode="json"),
    )
    await db.commit()
    await db.refresh(orphanage)
    return OrphanageRead.model_validate(orphanage)
