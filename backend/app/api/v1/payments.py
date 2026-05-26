import csv
import io
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.payment import PaymentCreate, PaymentRead, PaymentStatusUpdate
from app.services.audit import record_audit
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


@router.post("/{payment_id}/status", response_model=PaymentRead)
async def update_payment_status(
    payment_id: UUID,
    payload: PaymentStatusUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> PaymentRead:
    """Admin override: change a payment's status manually. Audits the
    before/after so any reconciliation question has a paper trail."""
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id))
    if payment is None:
        raise NotFound("Payment")
    old_status = payment.status
    if old_status == payload.status:
        return PaymentRead.model_validate(payment)

    payment.status = payload.status
    now = datetime.now(UTC)
    if payload.status == "completed" and payment.completed_at is None:
        payment.completed_at = now
    if payload.status == "failed":
        payment.failed_at = now
        payment.failure_reason = payload.reason

    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="payment.status_changed",
        entity_type="payment",
        entity_id=payment.id,
        old_values={"status": old_status},
        new_values={"status": payload.status, "reason": payload.reason},
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(payment)
    return PaymentRead.model_validate(payment)


_CSV_COLUMNS = (
    "code",
    "donor_id",
    "sponsorship_id",
    "amount",
    "currency",
    "payment_method",
    "payment_gateway",
    "gateway_transaction_id",
    "status",
    "completed_at",
    "created_at",
)


@router.get("/export.csv")
async def export_payments_csv(
    db: DbSession,
    _user: CurrentUser,
    donor_id: UUID | None = None,
    sponsorship_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> StreamingResponse:
    """Stream payments matching the same filters as the list endpoint, as
    CSV. Useful for finance ops who need to reconcile in Excel.
    Capped at 10 000 rows to keep memory bounded; tighten the filters
    if the response would exceed that."""
    stmt = select(Payment)
    if donor_id:
        stmt = stmt.where(Payment.donor_id == donor_id)
    if sponsorship_id:
        stmt = stmt.where(Payment.sponsorship_id == sponsorship_id)
    if status_filter:
        stmt = stmt.where(Payment.status == status_filter)
    stmt = stmt.order_by(Payment.created_at.desc()).limit(10_000)

    rows = (await db.scalars(stmt)).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for p in rows:
        writer.writerow(
            [
                p.code,
                str(p.donor_id),
                str(p.sponsorship_id) if p.sponsorship_id else "",
                str(p.amount),
                p.currency,
                p.payment_method,
                p.payment_gateway or "",
                p.gateway_transaction_id or "",
                p.status,
                p.completed_at.isoformat() if p.completed_at else "",
                p.created_at.isoformat(),
            ]
        )

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rufaqaa-payments.csv"'},
    )
