from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.schemas.common import Page
from app.schemas.payment import PaymentCreate, PaymentRead
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[PaymentRead])
async def list_payments(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    donor_id: UUID | None = None,
    sponsorship_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[PaymentRead]:
    stmt = select(Payment)
    if donor_id:
        stmt = stmt.where(Payment.donor_id == donor_id)
    if sponsorship_id:
        stmt = stmt.where(Payment.sponsorship_id == sponsorship_id)
    if status_filter:
        stmt = stmt.where(Payment.status == status_filter)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Payment.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[PaymentRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
async def create_payment(
    payload: PaymentCreate,
    db: DbSession,
    user: CurrentUser,
) -> PaymentRead:
    """Record a manual / cash / cheque payment.

    For gateway-initiated payments use the webhook endpoint instead — this
    handler is for staff entering offline payments by hand.
    """
    donor = await db.scalar(select(Donor).where(Donor.id == payload.donor_id))
    if donor is None:
        raise NotFound("Donor")

    sponsorship: Sponsorship | None = None
    if payload.sponsorship_id is not None:
        sponsorship = await db.scalar(
            select(Sponsorship).where(Sponsorship.id == payload.sponsorship_id)
        )
        if sponsorship is None:
            raise NotFound("Sponsorship")

    now = datetime.now(UTC)
    payment = Payment(
        organization_id=user.organization_id,
        code=generate_code("PAY"),
        donor_id=payload.donor_id,
        sponsorship_id=payload.sponsorship_id,
        orphan_id=payload.orphan_id or (sponsorship.orphan_id if sponsorship is not None else None),
        amount=payload.amount,
        currency=payload.currency,
        payment_method=payload.payment_method,
        payment_gateway=payload.payment_gateway,
        gateway_transaction_id=payload.gateway_transaction_id,
        status="completed",
        completed_at=now,
        notes=payload.notes,
        created_by=user.id,
    )

    if sponsorship is not None:
        sponsorship.total_paid = (sponsorship.total_paid or 0) + payload.amount
        sponsorship.payments_count = (sponsorship.payments_count or 0) + 1
        sponsorship.last_payment_date = now.date()
        sponsorship.last_payment_amount = payload.amount

    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return PaymentRead.model_validate(payment)
