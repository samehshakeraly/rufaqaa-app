import csv
import io
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.config import settings
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.payment import (
    PaymentCreate,
    PaymentInitiate,
    PaymentInitiateResponse,
    PaymentRead,
    PaymentReceipt,
    PaymentRefund,
    PaymentStatusUpdate,
)
from app.services import myfatoorah
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


# ────────────────────────────────────────────────────────────────────
# Admin-on-behalf hosted-checkout (walk-in donor flow)
# ────────────────────────────────────────────────────────────────────


class AdminInitiateOnBehalf(BaseModel):
    """The admin sits with a present-but-digitally-unable donor, picks
    them from the existing donor records, and starts a hosted checkout
    that the donor pays right now on a screen or their own phone."""

    donor_id: UUID
    sponsorship_id: UUID | None = None
    orphan_id: UUID | None = None
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    language: Literal["ar", "en"] = "ar"


@router.post(
    "/admin/initiate-on-behalf",
    response_model=PaymentInitiateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def admin_initiate_on_behalf(
    payload: AdminInitiateOnBehalf,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> PaymentInitiateResponse:
    """Admin-driven MyFatoorah checkout. The Payment row records BOTH
    the real donor and the admin who initiated. The webhook-side
    completion flow is unchanged."""
    donor = await db.scalar(
        select(Donor).where(Donor.id == payload.donor_id, Donor.deleted_at.is_(None))
    )
    if donor is None:
        raise NotFound("Donor")

    sponsorship: Sponsorship | None = None
    if payload.sponsorship_id is not None:
        sponsorship = await db.scalar(
            select(Sponsorship).where(Sponsorship.id == payload.sponsorship_id)
        )
        if sponsorship is None:
            raise NotFound("Sponsorship")
        if sponsorship.donor_id != donor.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sponsorship does not belong to this donor",
            )

    donor_org_id = donor.organization_id
    donor_id = donor.id
    donor_name = donor.full_name
    donor_email = donor.email
    donor_phone = donor.phone
    admin_user_id = user.id

    payment = Payment(
        organization_id=donor_org_id,
        code=generate_code("PAY"),
        donor_id=donor_id,
        sponsorship_id=sponsorship.id if sponsorship is not None else None,
        orphan_id=(sponsorship.orphan_id if sponsorship is not None else payload.orphan_id),
        amount=payload.amount,
        currency=payload.currency,
        payment_method="credit_card",
        payment_gateway="myfatoorah",
        status="pending",
        initiated_by_user_id=admin_user_id,
    )
    db.add(payment)
    await db.flush()
    customer_ref = sponsorship.code if sponsorship is not None else str(payment.id)
    callback_base = settings.APP_BASE_URL.rstrip("/")
    try:
        result = await myfatoorah.send_payment(
            amount=payload.amount,
            currency=payload.currency,
            customer_name=donor_name,
            customer_email=donor_email,
            customer_phone=donor_phone,
            customer_reference=customer_ref,
            callback_url=f"{callback_base}/payment/success?payment_id={payment.id}",
            error_url=f"{callback_base}/payment/failure?payment_id={payment.id}",
            language=payload.language,
        )
    except myfatoorah.MyFatoorahError as exc:
        await db.rollback()
        record_audit(
            db,
            organization_id=donor_org_id,
            user_id=admin_user_id,
            action="payment.admin_initiate_failed",
            entity_type="donor",
            entity_id=donor_id,
            new_values={"detail": exc.message, "amount": str(payload.amount)},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway error: {exc.message}",
        ) from exc

    payment.gateway_transaction_id = result.invoice_id
    record_audit(
        db,
        organization_id=donor_org_id,
        user_id=admin_user_id,
        action="payment.admin_initiated_on_behalf",
        entity_type="payment",
        entity_id=payment.id,
        new_values={
            "donor_id": str(donor_id),
            "invoice_id": result.invoice_id,
            "amount": str(payload.amount),
            "currency": payload.currency,
        },
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(payment)
    return PaymentInitiateResponse(
        payment_id=payment.id,
        invoice_id=result.invoice_id,
        payment_url=result.payment_url,
    )


@router.post(
    "/initiate",
    response_model=PaymentInitiateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def initiate_payment(
    payload: PaymentInitiate,
    db: DbSession,
    user: CurrentUser,
) -> PaymentInitiateResponse:
    """Open a hosted-checkout flow against MyFatoorah.

    Inserts a Payment row in ``pending`` state, calls MyFatoorah's
    SendPayment to get a hosted-page URL, then returns the URL for the
    SPA to redirect to. The donor enters card data on MyFatoorah's
    page — it never touches our server. The webhook handler picks up
    the resulting completion and flips this same row to ``completed``.
    """
    donor = await db.scalar(
        select(Donor).where(Donor.id == payload.donor_id, Donor.deleted_at.is_(None))
    )
    if donor is None:
        raise NotFound("Donor")

    # Authorization split:
    #   - Donors can only initiate payments tied to their own Donor row,
    #     and must have a verified email (PR #5).
    #   - Staff / admins can initiate on behalf of any donor in their org.
    if user.role == "donor":
        if donor.user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Donors can only initiate payments for themselves",
            )
        if user.email_verified_at is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Email verification required before sponsoring",
            )

    sponsorship: Sponsorship | None = None
    if payload.sponsorship_id is not None:
        sponsorship = await db.scalar(
            select(Sponsorship).where(Sponsorship.id == payload.sponsorship_id)
        )
        if sponsorship is None:
            raise NotFound("Sponsorship")
        if sponsorship.donor_id != donor.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sponsorship does not belong to this donor",
            )

    # Cache donor + user fields locally — after a rollback the ORM
    # expires attributes and lazy loads fail under async/greenlet.
    donor_org_id = donor.organization_id
    donor_id = donor.id
    donor_name = donor.full_name
    donor_email = donor.email
    donor_phone = donor.phone
    acting_user_id = user.id

    payment = Payment(
        organization_id=donor_org_id,
        code=generate_code("PAY"),
        donor_id=donor_id,
        sponsorship_id=sponsorship.id if sponsorship is not None else None,
        orphan_id=(sponsorship.orphan_id if sponsorship is not None else payload.orphan_id),
        amount=payload.amount,
        currency=payload.currency,
        payment_method="credit_card",
        payment_gateway="myfatoorah",
        status="pending",
    )
    db.add(payment)
    await db.flush()
    # Use the sponsorship code (stable, human-readable) as the customer
    # reference if we have one, else the payment id. The webhook handler
    # looks up by either.
    customer_ref = sponsorship.code if sponsorship is not None else str(payment.id)
    callback_base = settings.APP_BASE_URL.rstrip("/")
    try:
        result = await myfatoorah.send_payment(
            amount=payload.amount,
            currency=payload.currency,
            customer_name=donor_name,
            customer_email=donor_email,
            customer_phone=donor_phone,
            customer_reference=customer_ref,
            callback_url=f"{callback_base}/payment/success?payment_id={payment.id}",
            error_url=f"{callback_base}/payment/failure?payment_id={payment.id}",
            language=payload.language,
        )
    except myfatoorah.MyFatoorahError as exc:
        # Roll the pending row back so we don't leave orphaned rows on
        # every failed initiate; an audit entry still captures it.
        await db.rollback()
        record_audit(
            db,
            organization_id=donor_org_id,
            user_id=acting_user_id,
            action="payment.initiate_failed",
            entity_type="donor",
            entity_id=donor_id,
            new_values={"detail": exc.message, "amount": str(payload.amount)},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway error: {exc.message}",
        ) from exc

    payment.gateway_transaction_id = result.invoice_id
    record_audit(
        db,
        organization_id=donor_org_id,
        user_id=acting_user_id,
        action="payment.initiated",
        entity_type="payment",
        entity_id=payment.id,
        new_values={
            "invoice_id": result.invoice_id,
            "amount": str(payload.amount),
            "currency": payload.currency,
        },
    )
    await db.commit()
    await db.refresh(payment)

    return PaymentInitiateResponse(
        payment_id=payment.id,
        invoice_id=result.invoice_id,
        payment_url=result.payment_url,
    )


@router.post("/{payment_id}/refund", response_model=PaymentRead)
async def refund_payment(
    payment_id: UUID,
    payload: PaymentRefund,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> PaymentRead:
    """Admin-only: reverse a MyFatoorah charge.

    Refuses to refund anything except a ``completed`` MyFatoorah payment
    (the gateway has nothing to refund otherwise). On success the row
    moves to ``refunded`` (full) or ``partially_refunded`` (partial) —
    the difference is the requested amount vs the original."""
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id))
    if payment is None:
        raise NotFound("Payment")
    if payment.payment_gateway != "myfatoorah":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only MyFatoorah payments can be refunded through this endpoint",
        )
    if payment.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot refund a payment in '{payment.status}' state",
        )
    if not payment.gateway_transaction_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payment has no gateway transaction id",
        )
    if payload.amount > payment.amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refund amount exceeds the payment amount",
        )

    try:
        result = await myfatoorah.make_refund(
            invoice_id=payment.gateway_transaction_id,
            amount=payload.amount,
            reason=payload.reason,
        )
    except myfatoorah.MyFatoorahError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway error: {exc.message}",
        ) from exc

    is_full = payload.amount == payment.amount
    payment.status = "refunded" if is_full else "partially_refunded"
    record_audit(
        db,
        organization_id=payment.organization_id,
        user_id=user.id,
        action="payment.refunded",
        entity_type="payment",
        entity_id=payment.id,
        old_values={"status": "completed"},
        new_values={
            "status": payment.status,
            "amount": str(payload.amount),
            "reason": payload.reason,
            "refund_reference": result.refund_id,
        },
        is_sensitive=True,
    )
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


@router.get("/{payment_id}/receipt", response_model=PaymentReceipt)
async def payment_receipt(
    payment_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> PaymentReceipt:
    """One-shot bundle for the print-friendly receipt page.

    Joins donor / orphan / sponsorship / org so the receipt renders
    from a single response instead of fanning out."""
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id))
    if payment is None:
        raise NotFound("Payment")
    donor = await db.scalar(select(Donor).where(Donor.id == payment.donor_id))
    if donor is None:
        raise NotFound("Donor")
    org = await db.scalar(select(Organization).where(Organization.id == payment.organization_id))
    if org is None:
        raise NotFound("Organization")

    sponsorship = None
    if payment.sponsorship_id is not None:
        sponsorship = await db.scalar(
            select(Sponsorship).where(Sponsorship.id == payment.sponsorship_id)
        )
    orphan = None
    if payment.orphan_id is not None:
        orphan = await db.scalar(select(Orphan).where(Orphan.id == payment.orphan_id))

    orphan_name: str | None = None
    if orphan is not None:
        orphan_name = (
            orphan.full_name_en
            if orphan.full_name_en
            else f"{orphan.first_name} {orphan.family_name}"
        )

    return PaymentReceipt(
        payment_id=payment.id,
        payment_code=payment.code,
        amount=payment.amount,
        currency=payment.currency,
        payment_method=payment.payment_method,
        status=payment.status,
        completed_at=payment.completed_at,
        initiated_at=payment.initiated_at,
        donor_id=donor.id,
        donor_code=donor.code,
        donor_name=donor.full_name,
        donor_email=donor.email,
        sponsorship_id=sponsorship.id if sponsorship is not None else None,
        sponsorship_code=sponsorship.code if sponsorship is not None else None,
        orphan_id=orphan.id if orphan is not None else None,
        orphan_code=orphan.code if orphan is not None else None,
        orphan_name=orphan_name,
        organization_id=org.id,
        organization_name_ar=org.name_ar,
        organization_name_en=org.name_en,
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
