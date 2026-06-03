import csv
import io
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.partner import MarketingChannel
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.orphan import OrphanCreate, OrphanRead, OrphanUpdate
from app.schemas.timeline import Timeline, TimelineEvent
from app.services.audit import record_audit
from app.services.orphans import create_orphan_record, stamp_available_since

router = APIRouter()


@router.get("", response_model=Page[OrphanRead])
async def list_orphans(
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    case_status: str | None = None,
    channel_id: UUID | None = None,
    assignment_status: Literal["active", "expired", "all"] = "all",
    q: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> Page[OrphanRead]:
    """List orphans, optionally filtered by case_status and a search term.

    `q` does a Postgres full-text search against the trigger-maintained
    `search_vector` (covers Arabic + English name fields and the code) and
    also matches the code prefix directly so partial codes like "ORF-AB"
    still work.

    `channel_id` narrows to orphans assigned to a marketing channel.
    `assignment_status` filters by assignment deadline: "active" keeps
    orphans whose deadline is still in the future, "expired" those past it,
    "all" applies no deadline filter.
    """
    # Explicit org scope (defense-in-depth alongside RLS).
    stmt = select(Orphan).where(
        Orphan.deleted_at.is_(None),
        Orphan.organization_id == user.organization_id,
    )
    if case_status:
        stmt = stmt.where(Orphan.case_status == case_status)
    if channel_id:
        stmt = stmt.where(Orphan.assigned_to_channel_id == channel_id)
    if assignment_status == "active":
        stmt = stmt.where(Orphan.assignment_deadline >= datetime.now(UTC))
    elif assignment_status == "expired":
        stmt = stmt.where(Orphan.assignment_deadline < datetime.now(UTC))
    if q:
        # plainto_tsquery treats input as raw text and handles tokenisation,
        # which is safer than letting users craft tsquery operators.
        tsquery = func.plainto_tsquery("simple", q)
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                text("search_vector @@ plainto_tsquery('simple', :q)").bindparams(q=q),
                Orphan.code.ilike(like),
                Orphan.first_name.ilike(like),
                Orphan.family_name.ilike(like),
            )
        )
        # Rank: best matches first when a query was supplied
        stmt = stmt.order_by(
            text("ts_rank(search_vector, plainto_tsquery('simple', :q)) DESC").bindparams(q=q),
            Orphan.created_at.desc(),
        )
        # Avoid the "unused" warning about tsquery — it's still useful as a
        # readable reference even though we use raw text() above.
        _ = tsquery
    else:
        stmt = stmt.order_by(Orphan.created_at.desc())

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await db.scalars(stmt.limit(limit).offset(offset))).all()

    return Page(
        items=[OrphanRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=OrphanRead, status_code=status.HTTP_201_CREATED)
async def create_orphan(
    payload: OrphanCreate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanRead:
    """Register an orphan (lands ``pending_review``).

    Delegates to the shared :func:`create_orphan_record`, which is also used by
    the guardian self-service endpoint — so both obey the same no-duplicate
    rule (a violation of ``idx_orphans_no_duplicate`` comes back as a 409).
    """
    orphan = await create_orphan_record(
        db,
        user=user,
        data=payload,
        partner_organization_id=payload.partner_organization_id,
        family_id=payload.family_id,
        via="staff",
    )
    return OrphanRead.model_validate(orphan)


_CSV_COLUMNS = (
    "code",
    "first_name",
    "family_name",
    "date_of_birth",
    "gender",
    "nationality",
    "case_status",
    "is_sponsored",
    "current_balance",
    "created_at",
)


@router.get("/export.csv")
async def export_orphans_csv(
    db: DbSession,
    _user: CurrentUser,
    case_status: str | None = None,
) -> StreamingResponse:
    """Stream non-deleted orphans (optionally filtered by case_status)
    as CSV. Capped at 10 000 rows. Registered before /{orphan_id} so
    FastAPI doesn't try to parse 'export.csv' as a UUID."""
    stmt = select(Orphan).where(Orphan.deleted_at.is_(None))
    if case_status:
        stmt = stmt.where(Orphan.case_status == case_status)
    stmt = stmt.order_by(Orphan.created_at.desc()).limit(10_000)
    rows = (await db.scalars(stmt)).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for o in rows:
        writer.writerow(
            [
                o.code,
                o.first_name,
                o.family_name,
                o.date_of_birth.isoformat() if o.date_of_birth else "",
                o.gender,
                o.nationality or "",
                o.case_status,
                "true" if o.is_sponsored else "false",
                str(o.current_balance or 0),
                o.created_at.isoformat(),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rufaqaa-orphans.csv"'},
    )


@router.get("/{orphan_id}", response_model=OrphanRead)
async def get_orphan(
    orphan_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> OrphanRead:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    return OrphanRead.model_validate(orphan)


@router.patch("/{orphan_id}", response_model=OrphanRead)
async def update_orphan(
    orphan_id: UUID,
    payload: OrphanUpdate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanRead:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")

    changes: dict[str, dict[str, str | None]] = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(orphan, field)
        if old != value:
            changes[field] = {"old": _stringify(old), "new": _stringify(value)}
            setattr(orphan, field, value)

    if changes:
        record_audit(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            action="orphan.updated",
            entity_type="orphan",
            entity_id=orphan.id,
            old_values={k: v["old"] for k, v in changes.items()},
            new_values={k: v["new"] for k, v in changes.items()},
        )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


def _stringify(v: Any) -> Any:
    """JSON-safe representation for audit values (dates → ISO, UUIDs → str)."""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


@router.delete("/{orphan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Soft-delete an orphan record. Restricted to org admins."""
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    orphan.deleted_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.deleted",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"code": orphan.code},
        is_sensitive=True,
    )
    await db.commit()


class AssignChannelPayload(BaseModel):
    """Pass channel_id=null to unassign."""

    channel_id: UUID | None


@router.post("/{orphan_id}/assign-channel", response_model=OrphanRead)
async def assign_orphan_channel(
    orphan_id: UUID,
    payload: AssignChannelPayload,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> OrphanRead:
    """Attach (or detach) an orphan to a marketing channel. Validates
    that the channel belongs to the same organization and is active;
    null clears the assignment."""
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")

    if payload.channel_id is not None:
        channel = await db.scalar(
            select(MarketingChannel).where(MarketingChannel.id == payload.channel_id)
        )
        if channel is None:
            raise NotFound("Marketing channel")
        if channel.organization_id != orphan.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Channel belongs to a different organization",
            )
        if channel.status != "active":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot assign to a non-active channel",
            )

    old = orphan.assigned_to_channel_id
    orphan.assigned_to_channel_id = payload.channel_id
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.channel_assigned",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"assigned_to_channel_id": str(old) if old else None},
        new_values={
            "assigned_to_channel_id": (str(payload.channel_id) if payload.channel_id else None)
        },
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


# ── Case-status workflow ───────────────────────────────────────────────
#
# Schema's CaseStatus enum: pending_review → approved → available →
# reserved → sponsored → graduated/deceased/archived (or → rejected).
# OrphanUpdate intentionally excludes case_status — every status change
# flows through one of the endpoints below. partner_staff submits an
# orphan record (which lands as pending_review); partner_manager or an
# org admin reviews it.

# Approvers can decide on a pending case. partner_staff cannot — they
# submit, they don't approve. Mirrors the report-workflow split.
PARTNER_APPROVER_ROLES: tuple[str, ...] = ("partner_manager", *ADMIN_ROLES)


class OrphanRejectPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


async def _load_orphan_or_404(db: AsyncSession, orphan_id: UUID) -> Orphan:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    return orphan


def _check_case_transition(orphan: Orphan, expected_from: tuple[str, ...]) -> None:
    if orphan.case_status not in expected_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Orphan is in case_status '{orphan.case_status}', "
                f"expected one of {sorted(expected_from)}"
            ),
        )


@router.post("/{orphan_id}/approve", response_model=OrphanRead)
async def approve_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PARTNER_APPROVER_ROLES))],
) -> OrphanRead:
    """Mark a pending_review orphan as approved.

    Only partner_manager + org admins may approve — partner_staff submits
    but cannot self-approve, same separation the report workflow uses.
    """
    orphan = await _load_orphan_or_404(db, orphan_id)
    _check_case_transition(orphan, ("pending_review",))

    old_status = orphan.case_status
    orphan.case_status = "approved"
    orphan.approved_by_partner_at = datetime.now(UTC)
    orphan.approved_by_partner_user_id = user.id
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.approved",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"case_status": old_status},
        new_values={"case_status": orphan.case_status},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.post("/{orphan_id}/reject", response_model=OrphanRead)
async def reject_orphan(
    orphan_id: UUID,
    payload: OrphanRejectPayload,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PARTNER_APPROVER_ROLES))],
) -> OrphanRead:
    """Reject a pending_review orphan. Reason is required and stored on
    the row so reviewers can see why this case didn't move forward."""
    orphan = await _load_orphan_or_404(db, orphan_id)
    _check_case_transition(orphan, ("pending_review",))

    old_status = orphan.case_status
    orphan.case_status = "rejected"
    orphan.rejection_reason = payload.reason
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.rejected",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"case_status": old_status},
        new_values={"case_status": orphan.case_status, "rejection_reason": payload.reason},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.post("/{orphan_id}/release", response_model=OrphanRead)
async def release_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*PARTNER_APPROVER_ROLES))],
) -> OrphanRead:
    """Move an approved or reserved orphan back to the available pool —
    clearing any marketing-channel assignment. Used when a reservation
    lapses or a channel is reshuffled."""
    orphan = await _load_orphan_or_404(db, orphan_id)
    _check_case_transition(orphan, ("approved", "reserved"))

    old_status = orphan.case_status
    old_channel = orphan.assigned_to_channel_id
    orphan.case_status = "available"
    stamp_available_since(orphan)
    orphan.assigned_to_channel_id = None
    orphan.assignment_deadline = None
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.released",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={
            "case_status": old_status,
            "assigned_to_channel_id": str(old_channel) if old_channel else None,
        },
        new_values={"case_status": orphan.case_status, "assigned_to_channel_id": None},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.get("/{orphan_id}/timeline", response_model=Timeline)
async def orphan_timeline(
    orphan_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> Timeline:
    """Chronological feed of everything that has happened around an orphan:
    sponsorships, payments, and reports. Newest first, capped at 200
    events."""
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")

    sponsorships = (
        await db.scalars(select(Sponsorship).where(Sponsorship.orphan_id == orphan_id))
    ).all()
    payments = (await db.scalars(select(Payment).where(Payment.orphan_id == orphan_id))).all()
    reports = (
        await db.scalars(select(OrphanReport).where(OrphanReport.orphan_id == orphan_id))
    ).all()

    events: list[TimelineEvent] = []
    for sp in sponsorships:
        events.append(
            TimelineEvent(
                when=sp.created_at,
                kind="sponsorship",
                entity_id=sp.id,
                summary=f"{sp.code} · {sp.monthly_amount} {sp.currency}/{sp.payment_frequency}",
                amount=sp.monthly_amount,
                currency=sp.currency,
                status=sp.status,
            )
        )
    for p in payments:
        events.append(
            TimelineEvent(
                when=p.completed_at or p.initiated_at,
                kind="payment",
                entity_id=p.id,
                summary=f"{p.code} · {p.payment_method}",
                amount=p.amount,
                currency=p.currency,
                status=p.status,
            )
        )
    for r in reports:
        events.append(
            TimelineEvent(
                when=r.created_at,
                kind="report",
                entity_id=r.id,
                summary=f"{r.report_type} ({r.period_start}–{r.period_end})",
                status=r.status,
            )
        )

    events.sort(key=lambda e: e.when, reverse=True)
    return Timeline(items=events[:200])
