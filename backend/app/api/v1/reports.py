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
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import ADMIN_ROLES, FINANCE_ROLES, STAFF_ROLES, require_roles
from app.core.collections import (
    LATE_SPONSORSHIP_STATUSES,
    MIN_MONTHS_OVERDUE,
    installments_due,
    months_elapsed,
    outstanding_in_default_currency,
)
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.family import Guardian
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.report import (
    ReportCreate,
    ReportDetailRead,
    ReportRead,
    ReportTransition,
    ReportUpdate,
)
from app.services.exports import build_report_xlsx, render_report_pdf

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


@router.get("", response_model=Page[ReportDetailRead])
async def list_reports(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    orphan_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[ReportDetailRead]:
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
        items=[ReportDetailRead.model_validate(r) for r in rows],
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

    # Sections are typed at the boundary but persisted as plain JSONB — dump
    # each provided section to a JSON-native dict (None stays None).
    dumped = payload.model_dump(mode="json")
    report = OrphanReport(
        organization_id=user.organization_id,
        orphan_id=payload.orphan_id,
        report_type=payload.report_type,
        period_start=payload.period_start,
        period_end=payload.period_end,
        summary=payload.summary,
        educational_progress=dumped["educational_progress"],
        quran_progress=dumped["quran_progress"],
        activities=dumped["activities"],
        health_status=dumped["health_status"],
        psychological_status=dumped["psychological_status"],
        donor_message=payload.donor_message,
        is_milestone=payload.is_milestone,
        milestone_label=payload.milestone_label,
        # Default to "all sections visible" when the supervisor sends nothing.
        section_visibility=(
            payload.section_visibility if payload.section_visibility is not None else {}
        ),
        status="draft",
        submitted_by=user.id,
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)


_LATE_PAYERS_TITLE = "تقرير المتأخرين في السداد"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/late-payers")
async def late_payers_report(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
    export_format: Annotated[Literal["pdf", "xlsx"], Query(alias="format")] = "pdf",
) -> StreamingResponse:
    """المتأخرون في السداد — first data-backed Reports Center template.

    Selection reuses the worker-maintained overdue state through
    ``core/collections`` (status active/overdue + months_overdue >= 1) —
    it does not re-derive lateness from raw payment history. Registered
    before ``/{report_id}`` so FastAPI doesn't try to parse
    'late-payers' as a UUID.

    Privacy: the sponsored orphan appears only as its non-identifying
    code — no orphan name, location, health or family data leaves this
    endpoint.
    """
    org = await db.scalar(select(Organization).where(Organization.id == user.organization_id))
    if org is None:
        raise NotFound("Organization")
    default_currency = org.default_currency

    # Explicit org scope — never rely on RLS (the app's superuser DB
    # connection bypasses it). Donor/orphan joins are LEFT so a dangling
    # reference degrades a cell, never drops the late row.
    result = (
        await db.execute(
            select(Sponsorship, Donor.full_name, Orphan.code)
            .join(Donor, Donor.id == Sponsorship.donor_id, isouter=True)
            .join(Orphan, Orphan.id == Sponsorship.orphan_id, isouter=True)
            .where(
                Sponsorship.organization_id == user.organization_id,
                Sponsorship.status.in_(LATE_SPONSORSHIP_STATUSES),
                Sponsorship.months_overdue >= MIN_MONTHS_OVERDUE,
            )
            .order_by(Sponsorship.months_overdue.desc(), Sponsorship.code)
        )
    ).all()

    # Foreign-currency sponsorships convert through the latest completed
    # payment's stored rate (payments.exchange_rate → default currency);
    # with no known rate the cell renders "—" and stays out of the total.
    foreign_ids = [sp.id for sp, _, _ in result if sp.currency.upper() != default_currency.upper()]
    rate_by_sponsorship: dict[UUID, Decimal] = {}
    if foreign_ids:
        rate_rows = await db.execute(
            select(Payment.sponsorship_id, Payment.exchange_rate)
            .where(
                Payment.organization_id == user.organization_id,
                Payment.sponsorship_id.in_(foreign_ids),
                Payment.status == "completed",
                Payment.exchange_rate.is_not(None),
            )
            .distinct(Payment.sponsorship_id)
            .order_by(Payment.sponsorship_id, Payment.created_at.desc())
        )
        rate_by_sponsorship = {sid: rate for sid, rate in rate_rows.all()}

    today = datetime.now(UTC).date()
    rows: list[list[object]] = []
    total_outstanding = Decimal("0.00")
    for sp, donor_name, orphan_code in result:
        outstanding = outstanding_in_default_currency(
            sp.monthly_amount,
            sp.months_overdue,
            currency=sp.currency,
            default_currency=default_currency,
            exchange_rate=rate_by_sponsorship.get(sp.id),
        )
        if outstanding is not None:
            total_outstanding += outstanding
        rows.append(
            [
                sp.code,
                orphan_code or "—",
                donor_name or str(sp.donor_id),
                months_elapsed(sp.start_date, today, sp.end_date),
                installments_due(sp.payments_count, sp.months_overdue),
                sp.payments_count or 0,
                sp.months_overdue or 0,
                outstanding if outstanding is not None else "—",
                sp.last_payment_date.isoformat() if sp.last_payment_date else "—",
            ]
        )

    headers = [
        "رمز الكفالة",
        "رمز اليتيم",
        "الكافل",
        "الأشهر المنقضية",
        "الأقساط المستحقة",
        "الأقساط المسددة",
        "أشهر التأخر",
        f"المبلغ المستحق ({default_currency})",
        "آخر دفعة",
    ]
    total_late_label = "إجمالي الكفالات المتأخرة"
    total_outstanding_label = f"إجمالي المبالغ المستحقة ({default_currency})"
    filename = f"late-payers-report-{today.isoformat()}.{export_format}"

    if export_format == "xlsx":
        sheet_rows: list[list[object]] = [list(r) for r in rows]
        sheet_rows += [
            [],
            [total_late_label, len(rows)],
            [total_outstanding_label, total_outstanding],
        ]
        content = build_report_xlsx(
            _LATE_PAYERS_TITLE, [("المتأخرون في السداد", headers, sheet_rows)]
        )
        media_type = _XLSX_MIME
    else:
        content = render_report_pdf(
            "late_payers.html",
            {
                "title": _LATE_PAYERS_TITLE,
                "generated_at": today.isoformat(),
                "headers": headers,
                "rows": rows,
                "total_late": len(rows),
                "total_outstanding": str(total_outstanding),
                "default_currency": default_currency,
            },
        )
        media_type = "application/pdf"

    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{report_id}", response_model=ReportDetailRead)
async def get_report(
    report_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> ReportDetailRead:
    report = await _load_or_404(db, report_id, user)
    await _check_report_access(report, user, db)
    return ReportDetailRead.model_validate(report)


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
