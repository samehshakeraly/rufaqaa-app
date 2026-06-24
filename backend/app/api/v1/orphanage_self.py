"""Orphanage-manager self-service endpoints under `/orphanage/me`.

Mirrors the guardian self-portal pattern (`guardian_self.py`): the resource
itself is the gate — only a user that an `orphanages.manager_user_id` row
points to will resolve "my orphanage". Anyone else gets a 404, so we never
confirm that `/orphanage/me` is reachable when you aren't a manager. Because
the dar-assignment endpoint (`POST /orphanages`) validates that the assignee
is an `orphanage_manager` (see `orphanages._assert_user_can_manage`), the
resource gate restricts this surface to that role in practice.

Scope, deliberately narrow and modelled 1:1 on the guardian equivalents:

  * `GET /orphanage/me` — the manager's own orphanage (dar) profile.
  * `GET /orphanage/me/orphans` — the dar's resident orphans
    (`orphans.orphanage_id == my_orphanage.id`).
  * `GET|POST /orphanage/me/reports` — list / submit monthly reports for a
    resident orphan, identical to how a guardian reports for their own
    orphans (same `OrphanReport` model, same validation, same
    `pending_partner_approval` landing state) — only the ownership axis
    changes from `family_id` to `orphanage_id`.

Every query scopes to `user.organization_id` EXPLICITLY (mirrors
`orphanages.py`): a Postgres superuser connection bypasses RLS, so the
explicit org filter — not RLS alone — is the real guard. A resident in
*another* dar raises 403 (matching the guardian cross-family posture) rather
than 404, so we signal "you can't touch this" loudly.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.report import OrphanReport
from app.models.user import User
from app.schemas.orphanage import OrphanageRead
from app.schemas.report import (
    ActivitiesSection,
    EducationProgress,
    HealthStatus,
    PsychologicalStatus,
    QuranProgress,
    ReportRead,
    ReportType,
)

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────


class OrphanageOrphanRead(BaseModel):
    """Manager-safe projection of a resident orphan.

    Mirrors the guardian's `GuardianOrphanRead`: the core identity fields the
    portal needs, with no financial figures (`current_balance`,
    `balance_currency`, `is_sponsored`) and no donor / partner identity.
    """

    id: UUID
    code: str
    first_name: str
    family_name: str
    date_of_birth: date
    gender: str
    case_status: str
    profile_completion_percentage: int


class OrphanageReportCreate(BaseModel):
    """Body for a manager-submitted report.

    Lands directly in ``pending_partner_approval`` (the manager's act of
    sending IS the submission) and surfaces in the existing staff review
    queue. The five sections reuse the canonical typed models from
    ``app.schemas.report`` (validated at the boundary, persisted as plain
    JSONB) and carry the same donor-facing extras a supervisor controls:
    a per-section visibility map, a note to the sponsor, and milestone
    flagging. Photo/voice attachments are still deferred.
    """

    orphan_id: UUID
    report_type: ReportType = "monthly"
    period_start: date
    period_end: date
    summary: str | None = None
    educational_progress: EducationProgress | None = None
    quran_progress: QuranProgress | None = None
    activities: ActivitiesSection | None = None
    health_status: HealthStatus | None = None
    psychological_status: PsychologicalStatus | None = None
    donor_message: str | None = None
    is_milestone: bool = False
    milestone_label: str | None = None
    section_visibility: dict[str, bool] | None = None


# ── Helpers ────────────────────────────────────────────────────────────


async def _load_orphanage_or_404(db: AsyncSession, user: User) -> Orphanage:
    """Resolve the calling user to the orphanage (dar) they manage.

    Returns 404 (not 403) for non-manager users — we don't want to confirm
    that `/orphanage/me` is reachable when you don't run a dar. Scoped to the
    caller's org EXPLICITLY (mirrors `orphanages.py`) rather than trusting RLS
    alone, which a superuser connection bypasses.
    """
    orphanage = await db.scalar(
        select(Orphanage).where(
            Orphanage.manager_user_id == user.id,
            Orphanage.organization_id == user.organization_id,
        )
    )
    if orphanage is None:
        raise NotFound("Orphanage")
    return orphanage


async def _resident_or_error(db: AsyncSession, orphanage: Orphanage, orphan_id: UUID) -> Orphan:
    """Resolve an orphan and assert it is a resident of the manager's dar.

    Unknown id → 404; a real orphan resident in *another* dar (or living in a
    family home, i.e. ``orphanage_id IS NULL``) → 403 (matching the guardian
    cross-family posture). The org filter is explicit defense-in-depth.
    """
    orphan = await db.scalar(
        select(Orphan).where(
            Orphan.id == orphan_id,
            Orphan.organization_id == orphanage.organization_id,
            Orphan.deleted_at.is_(None),
        )
    )
    if orphan is None:
        raise NotFound("Orphan")
    if orphan.orphanage_id != orphanage.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This orphan is not a resident of your orphanage",
        )
    return orphan


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("/me", response_model=OrphanageRead)
async def get_orphanage_me(db: DbSession, user: CurrentUser) -> OrphanageRead:
    """Return the dar profile for the calling manager.

    404 for any caller who does not manage an orphanage — the resource is the
    gate (mirrors `GET /guardian/me`).
    """
    orphanage = await _load_orphanage_or_404(db, user)
    return OrphanageRead.model_validate(orphanage)


@router.get("/me/orphans", response_model=list[OrphanageOrphanRead])
async def list_my_residents(db: DbSession, user: CurrentUser) -> list[OrphanageOrphanRead]:
    """List the resident orphans of the manager's dar.

    Scoped to ``orphanage_id == my_orphanage.id`` AND the caller's org
    (explicit, not RLS alone). Financial fields are never serialised — the
    projection mirrors the guardian's privacy-safe orphan shape.
    """
    orphanage = await _load_orphanage_or_404(db, user)

    rows = (
        await db.scalars(
            select(Orphan)
            .where(
                Orphan.orphanage_id == orphanage.id,
                Orphan.organization_id == orphanage.organization_id,
                Orphan.deleted_at.is_(None),
            )
            .order_by(Orphan.created_at.desc())
        )
    ).all()

    return [
        OrphanageOrphanRead(
            id=o.id,
            code=o.code,
            first_name=o.first_name,
            family_name=o.family_name,
            date_of_birth=o.date_of_birth,
            gender=o.gender,
            case_status=o.case_status,
            profile_completion_percentage=o.profile_completion_percentage,
        )
        for o in rows
    ]


@router.get("/me/reports", response_model=list[ReportRead])
async def list_my_resident_reports(
    db: DbSession,
    user: CurrentUser,
    orphan_id: Annotated[
        UUID, Query(description="Orphan UUID; must be a resident of the manager's orphanage")
    ],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ReportRead]:
    """List reports for one of the dar's resident orphans.

    403 if the orphan isn't a resident of the manager's dar — we'd rather
    signal "you can't touch this" loudly than 404 (which would leak orphan
    existence to non-owners). Mirrors `GET /guardian/me/reports`.
    """
    orphanage = await _load_orphanage_or_404(db, user)
    await _resident_or_error(db, orphanage, orphan_id)

    rows = (
        await db.scalars(
            select(OrphanReport)
            .where(OrphanReport.orphan_id == orphan_id)
            .order_by(OrphanReport.period_start.desc())
            .limit(limit)
        )
    ).all()
    return [ReportRead.model_validate(r) for r in rows]


@router.post("/me/reports", response_model=ReportRead, status_code=status.HTTP_201_CREATED)
async def create_my_resident_report(
    payload: OrphanageReportCreate,
    db: DbSession,
    user: CurrentUser,
) -> ReportRead:
    """Manager submits a structured report for one of their resident orphans.

    Richer than `POST /guardian/me/reports` (full typed sections + donor
    visibility + sponsor note + milestone), but it follows the same workflow:
    the report is created **directly in ``pending_partner_approval``** with
    ``submitted_by``/``submitted_at`` set, so it appears at once in the staff
    ``PartnerReportsReview`` queue and rides the existing approve/reject
    workflow — no fork. A non-resident orphan → 403; a caller who manages no
    dar → 404.
    """
    orphanage = await _load_orphanage_or_404(db, user)
    if payload.period_end < payload.period_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period_end must be on or after period_start",
        )
    orphan = await _resident_or_error(db, orphanage, payload.orphan_id)

    # Sections are typed at the boundary but persisted as plain JSONB — dump
    # each provided section to a JSON-native dict (None stays None), exactly
    # as the staff `reports.create_report` does.
    dumped = payload.model_dump(mode="json")
    report = OrphanReport(
        organization_id=user.organization_id,
        orphan_id=orphan.id,
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
        # Default to "all sections visible" when the manager sends nothing.
        section_visibility=(
            payload.section_visibility if payload.section_visibility is not None else {}
        ),
        status="pending_partner_approval",
        submitted_by=user.id,
        submitted_at=datetime.now(UTC),
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return ReportRead.model_validate(report)
