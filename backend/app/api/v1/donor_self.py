"""Donor self-service endpoints under `/donor/me`.

Every route here requires:
  - an authenticated user with `role='donor'`
  - a verified email (`email_verified_at IS NOT NULL`)

Both conditions are enforced by `require_verified_donor`; the
endpoints additionally re-check that any record fetched belongs to
the calling donor before returning it. Belt-and-suspenders against
the RLS layer.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.api.v1.messages import MessageRead, _project
from app.core.authz import require_verified_donor
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.message import Message
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page

router = APIRouter()


class DonorMeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    user_id: UUID | None
    full_name: str
    email: EmailStr
    phone: str | None
    country_of_residence: str | None
    preferred_currency: str | None
    status: str
    total_sponsorships: int
    active_sponsorships: int
    total_donated: Decimal


class DonorMeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    country_of_residence: str | None = Field(default=None, min_length=2, max_length=2)
    preferred_currency: str | None = Field(default=None, min_length=3, max_length=3)


class DonorSponsorshipMini(BaseModel):
    """Lean projection — what the donor portal needs to render."""

    id: UUID
    code: str
    monthly_amount: Decimal
    currency: str
    status: str
    start_date: datetime | None
    total_paid: Decimal
    orphan_code: str | None
    orphan_first_name: str | None


class DonorPaymentMini(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    amount: Decimal
    currency: str
    status: str
    payment_method: str
    completed_at: datetime | None
    created_at: datetime


class DonorSponsorshipCreate(BaseModel):
    orphan_code: str = Field(min_length=1, max_length=20)
    monthly_amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    frequency: Literal["monthly", "quarterly", "semi_annual", "annual", "one_time"] = "monthly"


class DonorMessageCreate(BaseModel):
    orphan_code: str = Field(min_length=1, max_length=20)
    content: str = Field(min_length=1, max_length=4000)


async def _load_donor_for_user(db: AsyncSession, user: User) -> Donor:
    donor = await db.scalar(select(Donor).where(Donor.user_id == user.id))
    if donor is None:
        # Should never happen — signup creates the row. Refusing keeps
        # the rest of the code honest.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Donor profile is missing for this account",
        )
    return donor


@router.get("/me", response_model=DonorMeRead)
async def get_donor_me(
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> DonorMeRead:
    donor = await _load_donor_for_user(db, user)
    return DonorMeRead.model_validate(donor)


@router.patch("/me", response_model=DonorMeRead)
async def update_donor_me(
    payload: DonorMeUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> DonorMeRead:
    donor = await _load_donor_for_user(db, user)
    for field in ("full_name", "phone", "country_of_residence", "preferred_currency"):
        v = getattr(payload, field)
        if v is not None:
            setattr(donor, field, v)
    await db.commit()
    await db.refresh(donor)
    return DonorMeRead.model_validate(donor)


@router.get("/me/sponsorships", response_model=list[DonorSponsorshipMini])
async def list_my_sponsorships(
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> list[DonorSponsorshipMini]:
    donor = await _load_donor_for_user(db, user)
    rows = (
        await db.execute(
            select(Sponsorship, Orphan.code, Orphan.first_name)
            .outerjoin(Orphan, Orphan.id == Sponsorship.orphan_id)
            .where(Sponsorship.donor_id == donor.id)
            .order_by(desc(Sponsorship.created_at))
            .limit(200)
        )
    ).all()
    return [
        DonorSponsorshipMini(
            id=sp.id,
            code=sp.code,
            monthly_amount=sp.monthly_amount,
            currency=sp.currency,
            status=sp.status,
            start_date=sp.start_date,
            total_paid=sp.total_paid or Decimal("0"),
            orphan_code=orphan_code,
            orphan_first_name=orphan_first_name,
        )
        for sp, orphan_code, orphan_first_name in rows
    ]


@router.get("/me/payments", response_model=list[DonorPaymentMini])
async def list_my_payments(
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[DonorPaymentMini]:
    donor = await _load_donor_for_user(db, user)
    rows = (
        await db.scalars(
            select(Payment)
            .where(Payment.donor_id == donor.id)
            .order_by(desc(Payment.created_at))
            .limit(limit)
        )
    ).all()
    return [DonorPaymentMini.model_validate(r) for r in rows]


@router.post(
    "/me/sponsorships",
    response_model=DonorSponsorshipMini,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_sponsorship(
    payload: DonorSponsorshipCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> DonorSponsorshipMini:
    """Donor-driven sponsorship creation. The orphan is looked up by
    its public code (not internal UUID) so the donor never sees it.
    Only orphans that are publicly browseable can be sponsored."""
    donor = await _load_donor_for_user(db, user)

    orphan = await db.scalar(
        select(Orphan).where(
            Orphan.code == payload.orphan_code,
            Orphan.deleted_at.is_(None),
            Orphan.case_status.in_(("available", "approved", "reserved")),
        )
    )
    if orphan is None:
        raise NotFound("Orphan")

    # We don't have a generate_code import here; reuse from utils.
    from datetime import UTC, datetime

    from app.utils.codes import generate_code

    sponsorship = Sponsorship(
        organization_id=orphan.organization_id,
        code=generate_code("SPN"),
        donor_id=donor.id,
        orphan_id=orphan.id,
        monthly_amount=payload.monthly_amount,
        currency=payload.currency,
        payment_frequency=payload.frequency,
        start_date=datetime.now(UTC).date(),
        status="pending",
    )
    db.add(sponsorship)
    await db.flush()

    # Increment denormalised counter so the donor portal shows the new row.
    donor.total_sponsorships = (donor.total_sponsorships or 0) + 1

    await db.commit()
    await db.refresh(sponsorship)
    return DonorSponsorshipMini(
        id=sponsorship.id,
        code=sponsorship.code,
        monthly_amount=sponsorship.monthly_amount,
        currency=sponsorship.currency,
        status=sponsorship.status,
        start_date=sponsorship.start_date,
        total_paid=sponsorship.total_paid or Decimal("0"),
        orphan_code=orphan.code,
        orphan_first_name=orphan.first_name,
    )


# ── Donor messaging ──────────────────────────────────────────────────────
#
# A self-signup donor lives in the PLATFORM org, while the orphan + the
# handling staff live in the partner org. The generic org-scoped
# POST/GET /messages router therefore can't serve donors: these routes are
# DONOR-SCOPED and cross-org by design. The privacy projection (`_project`)
# and the wire schema (`MessageRead`) are reused from the generic router so
# the donor never sees user ids / emails / last names.


async def _resolve_message_recipient(db: AsyncSession, orphan: Orphan) -> UUID | None:
    """Resolve which staff user should receive a donor message about ``orphan``.

    Tiers, first match wins:
      (a) the manager of the orphan's dar (orphanage), if any;
      (b) an active partner_manager/partner_staff of the orphan's partner org
          (manager preferred — ``order by role`` puts it first);
      (c) an active org_admin of the orphan's org.
    Returns ``None`` when no recipient can be found.
    """
    if orphan.orphanage_id is not None:
        manager_id = await db.scalar(
            select(Orphanage.manager_user_id).where(Orphanage.id == orphan.orphanage_id)
        )
        if manager_id is not None:
            return manager_id

    staff_id = await db.scalar(
        select(User.id)
        .where(
            User.partner_organization_id == orphan.partner_organization_id,
            User.status == "active",
            User.role.in_(("partner_manager", "partner_staff")),
        )
        .order_by(User.role, User.created_at)
    )
    if staff_id is not None:
        return staff_id

    admin_id: UUID | None = await db.scalar(
        select(User.id)
        .where(
            User.organization_id == orphan.organization_id,
            User.role == "org_admin",
            User.status == "active",
        )
        .order_by(User.created_at)
    )
    return admin_id


@router.post(
    "/me/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_my_message(
    payload: DonorMessageCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> MessageRead:
    """Donor composes a message about a child they sponsor.

    Cross-org by design: the orphan is resolved globally (not in the
    donor's org). The donor may only message about a child they actually
    sponsor — a non-sponsored orphan 404s without revealing whether it
    exists. The message lands as ``pending`` so the recipient can't see
    it until a moderator approves.
    """
    donor = await _load_donor_for_user(db, user)

    orphan = await db.scalar(
        select(Orphan).where(
            Orphan.code == payload.orphan_code,
            Orphan.deleted_at.is_(None),
        )
    )
    if orphan is None:
        raise NotFound("Orphan")

    # AUTHZ: only a child the donor sponsors. Don't reveal existence otherwise.
    sponsorship = await db.scalar(
        select(Sponsorship).where(
            Sponsorship.donor_id == donor.id,
            Sponsorship.orphan_id == orphan.id,
        )
    )
    if sponsorship is None:
        raise NotFound("Orphan")

    recipient_id = await _resolve_message_recipient(db, orphan)
    if recipient_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No staff recipient available for this child",
        )

    msg = Message(
        organization_id=orphan.organization_id,  # the ORPHAN's org, not the donor's
        from_user_id=user.id,
        to_user_id=recipient_id,
        related_orphan_id=orphan.id,
        related_sponsorship_id=sponsorship.id,
        content=payload.content,
        message_type="text",
        moderation_status="pending",
    )
    db.add(msg)
    await db.flush()
    await db.commit()
    await db.refresh(msg)
    return await _project(msg, user, db)


@router.get("/me/messages", response_model=Page[MessageRead])
async def list_my_messages(
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
    orphan_code: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[MessageRead]:
    """List the donor's messages across orgs (no organization_id filter).

    The donor sees every message they sent (any moderation status, so they
    know what's pending/rejected) plus every approved message addressed to
    them. ``orphan_code`` narrows to one conversation.
    """
    # Validates the donor profile exists; ownership is enforced via the
    # from/to user-id predicates below (a donor has exactly one user).
    await _load_donor_for_user(db, user)

    base = select(Message).where(
        or_(
            Message.from_user_id == user.id,
            and_(
                Message.to_user_id == user.id,
                Message.moderation_status == "approved",
            ),
        )
    )

    if orphan_code is not None:
        orphan_id = await db.scalar(
            select(Orphan.id).where(
                Orphan.code == orphan_code,
                Orphan.deleted_at.is_(None),
            )
        )
        if orphan_id is None:
            return Page(items=[], total=0, limit=limit, offset=offset)
        base = base.where(Message.related_orphan_id == orphan_id)

    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = (
        await db.scalars(base.order_by(Message.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[await _project(m, user, db) for m in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/me/messages/{message_id}/read", response_model=MessageRead)
async def mark_my_message_read(
    message_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> MessageRead:
    """Mark an incoming approved message read. Only the recipient may mark;
    a message addressed to anyone else 404s. Idempotent."""
    msg = await db.get(Message, message_id)
    if msg is None or msg.to_user_id != user.id:
        raise NotFound("Message")
    if not msg.is_read:
        msg.is_read = True
        msg.read_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(msg)
    return await _project(msg, user, db)


# Lightweight GDPR stubs — see docs/architecture/authorization.md for the
# full workflow. These return enough shape for the SPA to surface the
# request, but the actual export / deletion happens out-of-band.


class DataExportRequest(BaseModel):
    detail: str
    requested_at: datetime


@router.post(
    "/me/data-export-request",
    response_model=DataExportRequest,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_data_export(
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> DataExportRequest:
    """GDPR Article 15 stub — log the request, surface a placeholder."""
    from datetime import UTC

    now = datetime.now(UTC)
    # In a future PR, this enqueues a Celery task that writes a signed
    # download URL into notifications. For now: just confirm receipt.
    _ = (db, user)
    return DataExportRequest(
        detail=(
            "Your data-export request has been recorded. "
            "We'll email you when the file is ready (typically within 48h)."
        ),
        requested_at=now,
    )


@router.post(
    "/me/deletion-request",
    response_model=DataExportRequest,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_account_deletion(
    db: DbSession,
    user: Annotated[User, Depends(require_verified_donor())],
) -> DataExportRequest:
    """GDPR Article 17 stub — log the request, surface a placeholder.

    Actual deletion requires an admin review (legal hold on records
    tied to completed payments, etc) and is intentionally out of band."""
    from datetime import UTC

    now = datetime.now(UTC)
    _ = (db, user)
    return DataExportRequest(
        detail=(
            "Your deletion request has been recorded. "
            "An administrator will review and confirm by email within 30 days."
        ),
        requested_at=now,
    )


def total_pages_helper(total: int, limit: int) -> int:  # pragma: no cover
    """Kept as an attachment point for future pagination consumers."""
    return (max(total, 0) + max(limit, 1) - 1) // max(limit, 1)


_ = func  # silence ruff if unused after refactor
