"""Orphan periodic reports — guardian submits → partner approves → org
approves → published to donor.

Per-report endpoints enforce two separate access checks:

  * **Ownership** (`_check_report_access`) — applies to GET / PATCH /
    submit. Guardians may only touch reports tied to orphans in their
    own family; staff/admins pass through to the org-RLS scope.

  * **Workflow role** (`REPORT_REVIEWER_ROLES`) — applies to the four
    review transitions (approve-partner / approve-org / publish /
    reject). Mirrors `PARTNER_APPROVER_ROLES` in orphans.py so the same
    "partner_manager + admins" set decides the same kinds of
    transitions.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.family import Guardian
from app.models.orphan import Orphan
from app.models.report import OrphanReport
from app.models.user import User
from app.schemas.common import Page
from app.schemas.report import ReportCreate, ReportRead, ReportTransition, ReportUpdate

router = APIRouter()


# Reviewers can advance the report workflow. Guardians and partner_staff
# CANNOT — same split as the orphan approval workflow.
REPORT_REVIEWER_ROLES: tuple[str, ...] = ("partner_manager", *ADMIN_ROLES)


# Allowed forward transitions on the approval workflow.
_NEXT = {
    "draft": "pending_partner_approval",
    "pending_partner_approval": "partner_approved",
    "partner_approved": "pending_org_approval",
    "pending_org_approval": "org_approved",
    "org_approved": "published_to_donor",
}


def _now() -> datetime:
    return datetime.now(UTC)


@router.get("", response_model=Page[ReportRead])
async def list_reports(
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    orphan_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[ReportRead]:
    # Explicit org scope on the base statement — the app's superuser DB
    # connection bypasses RLS, so without this filter reports leak across orgs.
    stmt = select(OrphanReport).where(OrphanReport.organization_id == user.organization_id)
    if orphan_id:
        stmt = stmt.where(OrphanReport.orphan_id == orphan_id)
    if status_filter:
        stmt = stmt.where(OrphanReport.status == status_filter)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(OrphanReport.period_start.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[ReportRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
async def create_report(
    payload: ReportCreate,
    db: DbSession,
    user: CurrentUser,
) -> ReportRead:
    if payload.period_end < payload.period_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period_end must be on or after period_start",
        )
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == payload.orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")

    # Guardians may only create reports for orphans in their own family.
    # Staff/admins pass through to the org-scoped RLS check.
    if user.role == "guardian":
        guardian = await db.scalar(select(Guardian).where(Guardian.user_id == user.id))
        if guardian is None or orphan.family_id != guardian.family_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot create a report for an orphan outside your family",
            )

    report = OrphanReport(
        organization_id=user.organization_id,
        orphan_id=payload.orphan_id,
        report_type=payload.report_type,
        period_start=payload.period_start,
        period_end=payload.period_end,
        summary=payload.summary,
        educational_progress=payload.educational_progress,
        quran_progress=payload.quran_progress,
        activities=payload.activities,
        health_status=payload.health_status,
        psychological_status=payload.psychological_status,
        status="draft",
        submitted_by=user.id,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.get("/{report_id}", response_model=ReportRead)
async def get_report(
    report_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> ReportRead:
    report = await _load_or_404(db, report_id, user)
    await _check_report_access(report, user, db)
    return ReportRead.model_validate(report)


@router.patch("/{report_id}", response_model=ReportRead)
async def update_report(
    report_id: UUID,
    payload: ReportUpdate,
    db: DbSession,
    user: CurrentUser,
) -> ReportRead:
    """Fill in or revise a draft report's content sections."""
    report = await _load_or_404(db, report_id, user)
    await _check_report_access(report, user, db)
    if report.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"Report is in status '{report.status}'; only drafts can be edited"),
        )
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(report, field, value)
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


async def _load_or_404(db: AsyncSession, report_id: UUID, user: User) -> OrphanReport:
    """Org-scoped fetch-by-id for the per-report endpoints.

    Explicit org scoping, never RLS — the app's superuser DB connection
    bypasses it — so a report in another org 404s here, before any workflow
    or ownership check runs. The guardian family-ownership check in
    :func:`_check_report_access` still applies on top for guardians.
    """
    return await get_in_org_or_404(db, OrphanReport, report_id, user)


async def _check_report_access(report: OrphanReport, user: User, db: AsyncSession) -> None:
    """Per-report ownership check.

    Guardians may only touch reports tied to orphans in their own family;
    staff/admin roles pass through (the org-scoped RLS check on the
    underlying session is the wider safety net).
    """
    if user.role != "guardian":
        return

    guardian = await db.scalar(select(Guardian).where(Guardian.user_id == user.id))
    if guardian is None:
        # Logged in as guardian role but no Guardian row — refuse outright.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guardian profile not found",
        )

    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == report.orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None or orphan.family_id != guardian.family_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This report does not belong to your family",
        )


def _check_transition(report: OrphanReport, expected_from: str) -> None:
    if report.status != expected_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"Report is in status '{report.status}', expected '{expected_from}'"),
        )


@router.post("/{report_id}/submit", response_model=ReportRead)
async def submit_report(report_id: UUID, db: DbSession, user: CurrentUser) -> ReportRead:
    """Move a draft report into the partner approval queue.

    Same ownership rule as PATCH — the guardian who owns the orphan can
    submit the draft; partner/admin staff can also submit on their
    behalf.
    """
    report = await _load_or_404(db, report_id, user)
    await _check_report_access(report, user, db)
    _check_transition(report, "draft")
    report.status = _NEXT["draft"]
    report.submitted_by = user.id
    report.submitted_at = _now()
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.post("/{report_id}/approve-partner", response_model=ReportRead)
async def approve_partner(
    report_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*REPORT_REVIEWER_ROLES))],
) -> ReportRead:
    report = await _load_or_404(db, report_id, user)
    _check_transition(report, "pending_partner_approval")
    report.status = "pending_org_approval"
    report.partner_approved_by = user.id
    report.partner_approved_at = _now()
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.post("/{report_id}/approve-org", response_model=ReportRead)
async def approve_org(
    report_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*REPORT_REVIEWER_ROLES))],
) -> ReportRead:
    report = await _load_or_404(db, report_id, user)
    _check_transition(report, "pending_org_approval")
    report.status = "org_approved"
    report.org_approved_by = user.id
    report.org_approved_at = _now()
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.post("/{report_id}/publish", response_model=ReportRead)
async def publish_report(
    report_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*REPORT_REVIEWER_ROLES))],
) -> ReportRead:
    report = await _load_or_404(db, report_id, user)
    _check_transition(report, "org_approved")
    report.status = "published_to_donor"
    report.published_at = _now()
    await db.commit()
    await db.refresh(report)

    # Fan out donor emails asynchronously. If the broker is down we still
    # return success — the publish itself is the source of truth and the
    # task can be retried out of band.
    try:
        from app.workers.tasks.notifications import notify_donors_of_report

        notify_donors_of_report.delay(str(report.id))
    except Exception:  # noqa: BLE001
        pass
    return ReportRead.model_validate(report)


@router.post("/{report_id}/reject", response_model=ReportRead)
async def reject_report(
    report_id: UUID,
    payload: ReportTransition,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*REPORT_REVIEWER_ROLES))],
) -> ReportRead:
    report = await _load_or_404(db, report_id, user)
    if report.status in ("published_to_donor", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Report already {report.status}",
        )
    report.status = "rejected"
    report.rejection_reason = payload.reason
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)
