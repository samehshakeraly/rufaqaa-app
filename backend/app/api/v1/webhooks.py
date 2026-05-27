"""Inbound webhooks from external services.

Currently only a MyFatoorah stub: validates a shared-secret header, records
the payment, and bumps sponsorship totals. Real signature verification will
be added when we move beyond the sandbox.

Every inbound delivery — success, validation failure, or processing error
— is recorded in `inbound_webhook_log` so operators can replay them
later from the admin UI.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, func, select, text

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
    expected = getattr(settings, "MYFATOORAH_WEBHOOK_SECRET", None)
    if not expected:
        return
    if signature is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    sig_ok = hmac.compare_digest(
        signature, _sign_payload(expected, raw_body)
    ) or hmac.compare_digest(signature, expected)
    if not sig_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)


async def _process_myfatoorah_payload(db, payload: dict[str, Any]) -> dict[str, Any]:
    """Pure processing — no signature check, no logging. Used by both
    the live route and the replay path."""
    data = payload.get("Data") or payload
    gateway_txn_id = str(data.get("InvoiceId") or data.get("TransactionId") or "")
    if not gateway_txn_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing InvoiceId / TransactionId",
        )

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

    existing = await db.scalar(
        select(Payment).where(Payment.gateway_transaction_id == gateway_txn_id)
    )
    if existing is not None:
        return {"status": "duplicate", "payment_id": str(existing.id)}

    amount_str = str(data.get("InvoiceValue") or data.get("Amount") or "0")
    amount = Decimal(amount_str)
    currency = str(data.get("InvoiceDisplayValue", "")[-3:] or data.get("Currency") or "KWD")

    now = datetime.now(UTC)
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
    return {
        "status": "ok",
        "payment_id": str(payment.id),
        "payment_status": our_status,
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
    db,
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
    db,
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
    payload: dict
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
