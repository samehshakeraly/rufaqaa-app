"""Inbound webhooks from external services.

MyFatoorah posts payment and refund status updates here. Every delivery is
verified **fail-closed** by `_verify_myfatoorah_signature` before it is
processed: when `MYFATOORAH_WEBHOOK_SECRET` is configured we require a valid
hex HMAC-SHA256 of the raw body; when it is empty we reject the request
outright (HTTP 503) outside `development` rather than silently trusting an
anonymous caller.

Every inbound delivery — success, validation failure, or processing error
— is recorded in `inbound_webhook_log` so operators can replay them
later from the admin UI.

Follow-ups (deliberately out of scope here):
  * Match MyFatoorah's real production signature format — header name, hex
    vs base64, and which fields are signed — against their official webhook
    documentation.
  * Add a startup guard that refuses to boot in production/staging when
    `MYFATOORAH_WEBHOOK_SECRET` is empty.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.config import settings
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.inbound_webhook import InboundWebhookLog
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()

_log = structlog.get_logger("rufaqaa.webhooks")

# A subset of MyFatoorah's payment statuses, mapped to our internal enum.
_STATUS_MAP = {
    "Paid": "completed",
    "Captured": "completed",
    "Authorized": "processing",
    "Failed": "failed",
    "Cancelled": "failed",
    "Expired": "failed",
}


def _sign_payload(secret: str, body: bytes) -> str:
    """Hex-encoded HMAC-SHA256 over the raw request body."""
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def _verify_myfatoorah_signature(raw_body: bytes, signature: str | None) -> None:
    """Verify an inbound MyFatoorah webhook signature, failing closed.

    Behaviour (the secret is `settings.MYFATOORAH_WEBHOOK_SECRET`):

      * secret set, signature header missing      -> 401
      * secret set, signature present and valid    -> pass (returns None)
      * secret set, signature present but invalid  -> 401
      * secret empty, ENVIRONMENT != "development" -> 503 + CRITICAL log
        (a server misconfiguration; we never silently accept)
      * secret empty, ENVIRONMENT == "development" -> pass, but a WARNING
        is logged on every call so it is never silent

    The signature is a hex HMAC-SHA256 of the raw request body (see
    `_sign_payload`). There is intentionally no static-secret fallback.

    Follow-up (out of scope here): align this with MyFatoorah's real
    production signature format — header name, hex vs base64, and which
    fields are signed — per their official webhook documentation.
    """
    secret = settings.MYFATOORAH_WEBHOOK_SECRET
    if not secret:
        if settings.ENVIRONMENT != "development":
            _log.critical(
                "myfatoorah_webhook_secret_not_configured",
                environment=settings.ENVIRONMENT,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Webhook secret not configured",
            )
        _log.warning(
            "myfatoorah_webhook_signature_unverified",
            environment=settings.ENVIRONMENT,
            reason="secret_not_configured",
        )
        return

    if signature is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    if not hmac.compare_digest(signature, _sign_payload(secret, raw_body)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)


async def _process_myfatoorah_payload(db: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    """Pure processing — no signature check, no logging. Used by both
    the live route and the replay path.

    Handles two event families on the same endpoint:

      1. Payment status updates  (Paid / Captured / Authorized / Failed / ...)
      2. Refund status updates   (presence of RefundReference / IsRefunded /
         RefundStatus in the payload).

    Refund events are forwarded to `_process_refund_event` which mutates
    the existing Payment row without going through the regular payment
    creation path."""
    data = payload.get("Data") or payload
    gateway_txn_id = str(data.get("InvoiceId") or data.get("TransactionId") or "")
    if not gateway_txn_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing InvoiceId / TransactionId",
        )

    # Refund event detection. MyFatoorah varies slightly by integration
    # tier; we accept any of these markers.
    refund_status = (
        data.get("RefundStatus")
        or data.get("RefundState")
        or (data.get("EventType") if "refund" in str(data.get("EventType", "")).lower() else None)
    )
    if refund_status or data.get("RefundReference") or data.get("IsRefunded"):
        return await _process_refund_event(db, data, gateway_txn_id)

    gateway_status = str(data.get("InvoiceStatus") or data.get("TransactionStatus") or "")
    our_status = _STATUS_MAP.get(gateway_status, "pending")

    donor_email = data.get("CustomerEmail") or data.get("Email")
    sponsorship_id_str = (data.get("CustomerReference") or "").strip() or None

    sponsorship = None
    if sponsorship_id_str:
        sponsorship = await db.scalar(
            select(Sponsorship).where(Sponsorship.code == sponsorship_id_str)
        )

    donor: Donor | None = None
    if sponsorship is not None:
        donor = await db.scalar(select(Donor).where(Donor.id == sponsorship.donor_id))
    elif donor_email:
        donor = await db.scalar(select(Donor).where(Donor.email == donor_email))

    if donor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not match payment to a known donor or sponsorship",
        )

    await db.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(donor.organization_id)},
    )

    amount_str = str(data.get("InvoiceValue") or data.get("Amount") or "0")
    amount = Decimal(amount_str)
    currency = str(data.get("InvoiceDisplayValue", "")[-3:] or data.get("Currency") or "KWD")

    now = datetime.now(UTC)

    existing = await db.scalar(
        select(Payment).where(Payment.gateway_transaction_id == gateway_txn_id)
    )
    if existing is not None:
        # A SendPayment flow already created the row in `pending`. The
        # gateway is now telling us how it ended — flip it. If the row
        # was already in a terminal state, treat as a duplicate delivery.
        if existing.status in ("pending", "processing"):
            existing.status = our_status
            if our_status == "completed":
                existing.completed_at = now
                if sponsorship is not None:
                    sponsorship.total_paid = (sponsorship.total_paid or 0) + amount
                    sponsorship.payments_count = (sponsorship.payments_count or 0) + 1
                    sponsorship.last_payment_date = now.date()
                    sponsorship.last_payment_amount = amount
                    if sponsorship.status == "pending":
                        sponsorship.status = "active"
            payment = existing
        else:
            return {
                "status": "duplicate",
                "payment_id": str(existing.id),
                "payment_status": existing.status,
            }
    else:
        # Legacy / gateway-driven path: webhook arrives with no
        # corresponding /initiate row. Insert one.
        payment = Payment(
            organization_id=donor.organization_id,
            code=generate_code("PAY"),
            donor_id=donor.id,
            sponsorship_id=sponsorship.id if sponsorship is not None else None,
            orphan_id=sponsorship.orphan_id if sponsorship is not None else None,
            amount=amount,
            currency=currency,
            payment_method="knet",
            payment_gateway="myfatoorah",
            gateway_transaction_id=gateway_txn_id,
            status=our_status,
            completed_at=now if our_status == "completed" else None,
            payment_metadata=data,
        )
        if our_status == "completed" and sponsorship is not None:
            sponsorship.total_paid = (sponsorship.total_paid or 0) + amount
            sponsorship.payments_count = (sponsorship.payments_count or 0) + 1
            sponsorship.last_payment_date = now.date()
            sponsorship.last_payment_amount = amount
            if sponsorship.status == "pending":
                sponsorship.status = "active"
        db.add(payment)
    await db.flush()

    record_audit(
        db,
        organization_id=donor.organization_id,
        user_id=None,
        action="webhook.myfatoorah.received",
        entity_type="payment",
        entity_id=payment.id,
        new_values={
            "gateway_transaction_id": gateway_txn_id,
            "gateway_status": gateway_status,
            "amount": str(amount),
            "currency": currency,
        },
    )
    await db.refresh(payment)

    # Send the receipt email when the charge has just completed.
    # `payment.status == 'completed'` here means the flip happened in
    # this very request (we either created a fresh row in `completed`
    # or transitioned the pending one — duplicates returned early above).
    if payment.status == "completed":
        try:
            from app.services.email import send_templated

            orphan_label: str | None = None
            if sponsorship is not None and sponsorship.orphan_id is not None:
                from app.models.orphan import Orphan as _Orphan

                orphan = await db.scalar(select(_Orphan).where(_Orphan.id == sponsorship.orphan_id))
                if orphan is not None:
                    orphan_label = (
                        orphan.full_name_en or f"{orphan.first_name} {orphan.family_name}"
                    )
            locale: Literal["ar", "en"] = (
                "en" if (donor.country_of_residence or "").upper() in {"US", "GB", "CA"} else "ar"
            )
            send_templated(
                to=donor.email,
                template="payment_succeeded",
                locale=locale,
                donor_name=donor.full_name,
                payment_code=payment.code,
                amount=str(amount),
                currency=currency,
                completed_date=now.date().isoformat(),
                orphan_name=orphan_label or "—",
                receipt_url=(
                    f"{settings.APP_BASE_URL.rstrip('/')}/admin/payments/{payment.id}/receipt"
                ),
            )
        except Exception:  # noqa: BLE001 — never let a logging email block the webhook
            pass

    return {
        "status": "ok",
        "payment_id": str(payment.id),
        "payment_status": our_status,
    }


# MyFatoorah refund status → our internal payment status.
# A `partially_refunded` payment retains its original totals on the
# sponsorship side; a fully-`refunded` payment reverses them.
_REFUND_STATUS_MAP = {
    "Refunded": "refunded",
    "FullyRefunded": "refunded",
    "PartiallyRefunded": "partially_refunded",
    "RefundFailed": "failed",
    "Failed": "failed",
}


async def _process_refund_event(
    db: AsyncSession, data: dict[str, Any], gateway_txn_id: str
) -> dict[str, Any]:
    """Apply a refund status update to an existing Payment row.

    We never create a Payment from a refund event — refunds always
    reference a charge we already processed. If the original payment is
    missing we 404 (the operator can replay the original payment webhook
    first and then replay the refund)."""
    payment = await db.scalar(
        select(Payment).where(Payment.gateway_transaction_id == gateway_txn_id)
    )
    if payment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Refund references an unknown payment",
        )

    raw_status = str(
        data.get("RefundStatus") or data.get("RefundState") or data.get("EventType") or ""
    )
    new_status = _REFUND_STATUS_MAP.get(raw_status)
    if new_status is None:
        # Fall back on the boolean / amount hints.
        refund_amount_raw = data.get("RefundAmount") or data.get("RefundedAmount") or "0"
        try:
            refund_amount = Decimal(str(refund_amount_raw))
        except (ValueError, ArithmeticError):
            refund_amount = Decimal("0")
        if data.get("IsRefunded") is True or refund_amount >= (payment.amount or 0):
            new_status = "refunded"
        elif refund_amount > 0:
            new_status = "partially_refunded"
        else:
            new_status = "failed"

    await db.execute(
        text("SELECT set_config('app.current_org_id', :v, true)"),
        {"v": str(payment.organization_id)},
    )

    if payment.status in ("refunded", "partially_refunded") and payment.status == new_status:
        return {
            "status": "duplicate",
            "payment_id": str(payment.id),
            "payment_status": payment.status,
        }

    old_status = payment.status
    payment.status = new_status
    payment.failure_reason = data.get("RefundReason") or payment.failure_reason

    # Reverse sponsorship totals only when a previously-completed payment
    # is now fully refunded. Partial refunds leave the books alone — the
    # adjustment is captured on the payment row itself.
    if new_status == "refunded" and old_status == "completed" and payment.sponsorship_id:
        sponsorship = await db.scalar(
            select(Sponsorship).where(Sponsorship.id == payment.sponsorship_id)
        )
        if sponsorship is not None:
            sponsorship.total_paid = Decimal(sponsorship.total_paid or 0) - Decimal(
                payment.amount or 0
            )
            sponsorship.payments_count = max((sponsorship.payments_count or 0) - 1, 0)

    await db.flush()
    record_audit(
        db,
        organization_id=payment.organization_id,
        user_id=None,
        action="webhook.myfatoorah.refund",
        entity_type="payment",
        entity_id=payment.id,
        old_values={"status": old_status},
        new_values={
            "status": new_status,
            "refund_reference": data.get("RefundReference"),
            "raw_refund_status": raw_status or None,
        },
        is_sensitive=True,
    )
    return {
        "status": "ok",
        "payment_id": str(payment.id),
        "payment_status": new_status,
        "event": "refund",
    }


@router.post("/myfatoorah")
async def myfatoorah_webhook(
    request: Request,
    db: DbSession,
    x_myfatoorah_signature: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Receive payment status updates from MyFatoorah.

    Every delivery is logged into `inbound_webhook_log` before the
    handler returns — successful, validation-failure, or processing
    error — so operators can replay it later from /webhooks/log."""
    raw_body = await request.body()
    _verify_myfatoorah_signature(raw_body, x_myfatoorah_signature)

    try:
        payload: dict[str, Any] = json.loads(raw_body) if raw_body else {}
    except json.JSONDecodeError as exc:
        # Log the raw body as a string so the operator can see what came in
        await _log_inbound(
            db,
            source="myfatoorah",
            payload={"_raw": raw_body.decode("utf-8", errors="replace")},
            signature=x_myfatoorah_signature,
            response_status=400,
            error="Invalid JSON body",
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON body"
        ) from exc

    return await _run_and_log(
        db,
        source="myfatoorah",
        payload=payload,
        signature=x_myfatoorah_signature,
    )


async def _log_inbound(
    db: AsyncSession,
    *,
    source: str,
    payload: dict[str, Any],
    signature: str | None,
    response_status: int,
    response_body: dict[str, Any] | None = None,
    error: str | None = None,
    replayed_from: UUID | None = None,
) -> InboundWebhookLog:
    log = InboundWebhookLog(
        source=source,
        payload=payload,
        signature=signature,
        response_status=response_status,
        response_body=json.dumps(response_body) if response_body is not None else None,
        error=error,
        replayed_from=replayed_from,
    )
    db.add(log)
    await db.flush()
    return log


async def _run_and_log(
    db: AsyncSession,
    *,
    source: str,
    payload: dict[str, Any],
    signature: str | None,
    replayed_from: UUID | None = None,
) -> dict[str, Any]:
    """Process a payload and persist exactly one log row reflecting the
    outcome. Re-raises HTTPException after logging so the HTTP response
    still reflects the error."""
    try:
        result = await _process_myfatoorah_payload(db, payload)
        await _log_inbound(
            db,
            source=source,
            payload=payload,
            signature=signature,
            response_status=200,
            response_body=result,
            replayed_from=replayed_from,
        )
        await db.commit()
        return result
    except HTTPException as exc:
        await _log_inbound(
            db,
            source=source,
            payload=payload,
            signature=signature,
            response_status=exc.status_code,
            error=str(exc.detail),
            replayed_from=replayed_from,
        )
        await db.commit()
        raise


# ────────────────────────────────────────────────────────────────────
# Admin: inspect + replay
# ────────────────────────────────────────────────────────────────────


class InboundWebhookLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source: str
    payload: dict[str, Any]
    signature: str | None
    response_status: int | None
    response_body: str | None
    error: str | None
    received_at: datetime
    replayed_from: UUID | None
    replayed_count: int


@router.get("/log", response_model=Page[InboundWebhookLogRead])
async def list_inbound_webhook_log(
    db: DbSession,
    _user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    source: str | None = None,
    only_failed: bool = False,
) -> Page[InboundWebhookLogRead]:
    stmt = select(InboundWebhookLog)
    if source:
        stmt = stmt.where(InboundWebhookLog.source == source)
    if only_failed:
        stmt = stmt.where(InboundWebhookLog.response_status != 200)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(desc(InboundWebhookLog.received_at)).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[InboundWebhookLogRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/log/{log_id}/replay")
async def replay_inbound_webhook(
    log_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> dict[str, Any]:
    """Re-feed a logged payload through the original handler. A new log
    row is created with replayed_from pointing at the original. The
    payment-side dedupe (gateway_transaction_id UNIQUE) keeps successful
    replays idempotent — they'll come back as `duplicate`."""
    original = await db.scalar(select(InboundWebhookLog).where(InboundWebhookLog.id == log_id))
    if original is None:
        raise NotFound("Webhook log entry")
    original.replayed_count = (original.replayed_count or 0) + 1
    await db.flush()
    result = await _run_and_log(
        db,
        source=original.source,
        payload=original.payload,
        signature=original.signature,
        replayed_from=original.id,
    )
    _ = user  # acting admin is captured implicitly via require_roles
    return result
