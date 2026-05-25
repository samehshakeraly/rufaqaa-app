"""Orphan periodic reports — guardian submits → partner approves → org
approves → published to donor.

This module exposes endpoints for each transition. Authorization is kept
permissive for the skeleton (any authenticated user in the same org can
transition); fine-grained role checks will land with the role/permission
work.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.report import OrphanReport
from app.schemas.common import Page
from app.schemas.report import ReportCreate, ReportRead, ReportTransition, ReportUpdate

router = APIRouter()


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
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    orphan_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[ReportRead]:
    stmt = select(OrphanReport)
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
    _user: CurrentUser,
) -> ReportRead:
    report = await db.scalar(select(OrphanReport).where(OrphanReport.id == report_id))
    if report is None:
        raise NotFound("Report")
    return ReportRead.model_validate(report)


@router.patch("/{report_id}", response_model=ReportRead)
async def update_report(
    report_id: UUID,
    payload: ReportUpdate,
    db: DbSession,
    _user: CurrentUser,
) -> ReportRead:
    """Fill in or revise a draft report's content sections."""
    report = await _load_or_404(db, report_id)
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


async def _load_or_404(db, report_id: UUID) -> OrphanReport:
    report = await db.scalar(select(OrphanReport).where(OrphanReport.id == report_id))
    if report is None:
        raise NotFound("Report")
    return report


def _check_transition(report: OrphanReport, expected_from: str) -> None:
    if report.status != expected_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"Report is in status '{report.status}', expected '{expected_from}'"),
        )


@router.post("/{report_id}/submit", response_model=ReportRead)
async def submit_report(report_id: UUID, db: DbSession, user: CurrentUser) -> ReportRead:
    """Move a draft report into the partner approval queue."""
    report = await _load_or_404(db, report_id)
    _check_transition(report, "draft")
    report.status = _NEXT["draft"]
    report.submitted_by = user.id
    report.submitted_at = _now()
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.post("/{report_id}/approve-partner", response_model=ReportRead)
async def approve_partner(report_id: UUID, db: DbSession, user: CurrentUser) -> ReportRead:
    report = await _load_or_404(db, report_id)
    _check_transition(report, "pending_partner_approval")
    report.status = "pending_org_approval"
    report.partner_approved_by = user.id
    report.partner_approved_at = _now()
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.post("/{report_id}/approve-org", response_model=ReportRead)
async def approve_org(report_id: UUID, db: DbSession, user: CurrentUser) -> ReportRead:
    report = await _load_or_404(db, report_id)
    _check_transition(report, "pending_org_approval")
    report.status = "org_approved"
    report.org_approved_by = user.id
    report.org_approved_at = _now()
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


@router.post("/{report_id}/publish", response_model=ReportRead)
async def publish_report(report_id: UUID, db: DbSession, _user: CurrentUser) -> ReportRead:
    report = await _load_or_404(db, report_id)
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
    _user: CurrentUser,
) -> ReportRead:
    report = await _load_or_404(db, report_id)
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
