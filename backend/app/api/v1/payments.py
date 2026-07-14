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
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import ADMIN_ROLES, FINANCE_ROLES, require_roles
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
    PaymentMethod,
    PaymentRead,
    PaymentReceipt,
    PaymentRefund,
    PaymentStatusUpdate,
    PaymentType,
)
from app.services import fx
from app.services.audit import record_audit
from app.services.payment_gateway import (
    PaymentGatewayError,
    UnknownGatewayError,
    get_gateway,
    select_gateway,
)
from app.utils.codes import generate_code

router = APIRouter()


async def _resolve_fx(
    db: AsyncSession, organization_id: UUID, payment_currency: str
) -> tuple[Organization, Decimal | None]:
    """Load the payment's org and the admin-maintained FX rate for
    ``payment_currency -> org.default_currency``.

    The org load filters by the id EXPLICITLY (never RLS — superuser
    connection). The rate comes from :func:`app.services.fx.get_rate`, the
    ONLY rate source: ``Decimal(1)`` when the currencies match (no DB hit),
    ``None`` when no rate row is configured — each payment write decides
    whether ``None`` fails closed (gateway paths) or is tolerated as an FX
    gap (manual recording).
    """
    org = await db.scalar(select(Organization).where(Organization.id == organization_id))
    if org is None:
        raise NotFound("Organization")
    rate = await fx.get_rate(
        db,
        organization_id=organization_id,
        base_currency=payment_currency,
        quote_currency=org.default_currency,
    )
    return org, rate


def _no_rate_configured(payment_currency: str, default_currency: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(f"No exchange rate configured for {payment_currency.upper()}->{default_currency}"),
    )


@router.get("", response_model=Page[PaymentRead])
async def list_payments(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    donor_id: UUID | None = None,
    sponsorship_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    donor_overdue: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    method: PaymentMethod | None = None,
    currency: Annotated[str | None, Query(min_length=3, max_length=3)] = None,
    payment_type: PaymentType | None = None,
) -> Page[PaymentRead]:
    """List payments for the org, with optional server-side filters.

    `status`, `donor_id`, `sponsorship_id` and `donor_overdue` are the existing
    filters. Added server-side filters (replacing client-side page narrowing):
    `date_from` / `date_to` bound the effective payment time —
    ``COALESCE(completed_at, initiated_at)``, the same instant the row displays;
    `method` matches `payment_method` exactly; `currency` matches the 3-letter
    code; `payment_type` is derived from `sponsorship_id` — "kafala" keeps
    payments tied to a sponsorship, "general" keeps the rest.

    Each row is enriched with the related `orphan_code` and a non-identifying
    `donor_reference` (both the related row's `code` — never a name or email).
    """
    # Explicit org scope (defense-in-depth alongside RLS).
    stmt = select(Payment).where(Payment.organization_id == user.organization_id)
    if donor_id:
        stmt = stmt.where(Payment.donor_id == donor_id)
    if sponsorship_id:
        stmt = stmt.where(Payment.sponsorship_id == sponsorship_id)
    if status_filter:
        stmt = stmt.where(Payment.status == status_filter)
    if method:
        stmt = stmt.where(Payment.payment_method == method)
    if currency:
        stmt = stmt.where(Payment.currency == currency)
    if payment_type == "kafala":
        stmt = stmt.where(Payment.sponsorship_id.is_not(None))
    elif payment_type == "general":
        stmt = stmt.where(Payment.sponsorship_id.is_(None))
    if date_from is not None or date_to is not None:
        # Effective payment time: completed_at when present, else initiated_at
        # (mirrors the client-side `completed_at ?? initiated_at` it replaces).
        when = func.coalesce(Payment.completed_at, Payment.initiated_at)
        if date_from is not None:
            stmt = stmt.where(when >= date_from)
        if date_to is not None:
            stmt = stmt.where(when <= date_to)
    if donor_overdue:
        # Donors with at least one active, overdue sponsorship — return a
        # single row per donor: their most recent payment. DISTINCT ON
        # (donor_id) ordered by created_at DESC picks the latest.
        overdue_donor_ids = (
            select(Sponsorship.donor_id)
            .where(
                Sponsorship.organization_id == user.organization_id,
                Sponsorship.status == "active",
                Sponsorship.months_overdue >= 1,
            )
            .distinct()
        )
        last_payment_ids = (
            select(Payment.id)
            .where(Payment.donor_id.in_(overdue_donor_ids))
            .distinct(Payment.donor_id)
            .order_by(Payment.donor_id, Payment.created_at.desc())
        )
        stmt = stmt.where(Payment.id.in_(last_payment_ids))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    # Enrich each row with the related codes. Donor is mandatory (INNER JOIN);
    # orphan is optional (LEFT JOIN). We pull only the `code` columns — never a
    # donor/orphan name or email — so identity is never exposed on this list.
    rows_stmt = (
        stmt.add_columns(Donor.code, Orphan.code)
        .join(Donor, Donor.id == Payment.donor_id)
        .outerjoin(Orphan, Orphan.id == Payment.orphan_id)
        .order_by(Payment.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(rows_stmt)

    items: list[PaymentRead] = []
    for payment, donor_code, orphan_code in result.all():
        item = PaymentRead.model_validate(payment)
        item.donor_reference = donor_code
        item.orphan_code = orphan_code
        items.append(item)

    return Page(items=items, total=total, limit=limit, offset=offset)


@router.post("", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
async def create_payment(
    payload: PaymentCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
) -> PaymentRead:
    """Record a manual / cash / cheque payment.

    For gateway-initiated payments use the webhook endpoint instead — this
    handler is for staff entering offline payments by hand. A missing FX
    rate does NOT block recording a real received payment: the row lands
    with NULL ``exchange_rate`` / ``amount_in_default_currency`` (stats
    already tolerate FX gaps) instead of storing an unconverted amount as
    if it were converted.
    """
    await get_in_org_or_404(db, Donor, payload.donor_id, user)

    sponsorship: Sponsorship | None = None
    if payload.sponsorship_id is not None:
        sponsorship = await get_in_org_or_404(db, Sponsorship, payload.sponsorship_id, user)

    _org, rate = await _resolve_fx(db, user.organization_id, payload.currency)

    now = datetime.now(UTC)
    payment = Payment(
        organization_id=user.organization_id,
        code=generate_code("PAY"),
        donor_id=payload.donor_id,
        sponsorship_id=payload.sponsorship_id,
        orphan_id=payload.orphan_id or (sponsorship.orphan_id if sponsorship is not None else None),
        amount=payload.amount,
        currency=payload.currency,
        exchange_rate=rate,
        amount_in_default_currency=(fx.convert(payload.amount, rate) if rate is not None else None),
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
    donor = await get_in_org_or_404(db, Donor, payload.donor_id, user, Donor.deleted_at.is_(None))

    sponsorship: Sponsorship | None = None
    if payload.sponsorship_id is not None:
        sponsorship = await get_in_org_or_404(db, Sponsorship, payload.sponsorship_id, user)
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

    # FAIL-CLOSED (R8-A2): the gateway path never creates a payment we
    # can't denominate in the org currency. Checked BEFORE the row is
    # built, so no dangling pending row is left behind. Same org as the
    # donor — donor was loaded org-scoped above.
    org, rate = await _resolve_fx(db, donor_org_id, payload.currency)
    if rate is None:
        raise _no_rate_configured(payload.currency, org.default_currency)

    gateway_name = select_gateway(currency=payload.currency)
    payment = Payment(
        organization_id=donor_org_id,
        code=generate_code("PAY"),
        donor_id=donor_id,
        sponsorship_id=sponsorship.id if sponsorship is not None else None,
        orphan_id=(sponsorship.orphan_id if sponsorship is not None else payload.orphan_id),
        amount=payload.amount,
        currency=payload.currency,
        exchange_rate=rate,
        amount_in_default_currency=fx.convert(payload.amount, rate),
        payment_method="credit_card",
        payment_gateway=gateway_name,
        status="pending",
        initiated_by_user_id=admin_user_id,
    )
    db.add(payment)
    await db.flush()
    customer_ref = sponsorship.code if sponsorship is not None else str(payment.id)
    callback_base = settings.APP_BASE_URL.rstrip("/")
    gateway = get_gateway(gateway_name)
    try:
        result = await gateway.send_payment(
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
    except PaymentGatewayError as exc:
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
    donor = await get_in_org_or_404(db, Donor, payload.donor_id, user, Donor.deleted_at.is_(None))

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
        sponsorship = await get_in_org_or_404(db, Sponsorship, payload.sponsorship_id, user)
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

    # FAIL-CLOSED (R8-A2): the gateway path never creates a payment we
    # can't denominate in the org currency. Checked BEFORE the row is
    # built, so no dangling pending row is left behind.
    org, rate = await _resolve_fx(db, donor_org_id, payload.currency)
    if rate is None:
        raise _no_rate_configured(payload.currency, org.default_currency)

    gateway_name = select_gateway(currency=payload.currency)
    payment = Payment(
        organization_id=donor_org_id,
        code=generate_code("PAY"),
        donor_id=donor_id,
        sponsorship_id=sponsorship.id if sponsorship is not None else None,
        orphan_id=(sponsorship.orphan_id if sponsorship is not None else payload.orphan_id),
        amount=payload.amount,
        currency=payload.currency,
        exchange_rate=rate,
        amount_in_default_currency=fx.convert(payload.amount, rate),
        payment_method="credit_card",
        payment_gateway=gateway_name,
        status="pending",
    )
    db.add(payment)
    await db.flush()
    # Use the sponsorship code (stable, human-readable) as the customer
    # reference if we have one, else the payment id. The webhook handler
    # looks up by either.
    customer_ref = sponsorship.code if sponsorship is not None else str(payment.id)
    callback_base = settings.APP_BASE_URL.rstrip("/")
    gateway = get_gateway(gateway_name)
    try:
        result = await gateway.send_payment(
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
    except PaymentGatewayError as exc:
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
    payment = await get_in_org_or_404(db, Payment, payment_id, user)
    try:
        gateway = get_gateway(payment.payment_gateway or "")
    except UnknownGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only MyFatoorah payments can be refunded through this endpoint",
        ) from exc
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
        result = await gateway.make_refund(
            invoice_id=payment.gateway_transaction_id,
            amount=payload.amount,
            reason=payload.reason,
        )
    except PaymentGatewayError as exc:
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
    payment = await get_in_org_or_404(db, Payment, payment_id, user)
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
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
) -> PaymentReceipt:
    """One-shot bundle for the print-friendly receipt page.

    Joins donor / orphan / sponsorship / org so the receipt renders
    from a single response instead of fanning out."""
    payment = await get_in_org_or_404(db, Payment, payment_id, user)
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
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
    donor_id: UUID | None = None,
    sponsorship_id: UUID | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> StreamingResponse:
    """Stream payments matching the same filters as the list endpoint, as
    CSV. Useful for finance ops who need to reconcile in Excel.
    Capped at 10 000 rows to keep memory bounded; tighten the filters
    if the response would exceed that."""
    stmt = select(Payment).where(Payment.organization_id == user.organization_id)
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
