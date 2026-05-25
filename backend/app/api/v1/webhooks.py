"""Inbound webhooks from external services.

Currently only a MyFatoorah stub: validates a shared-secret header, records
the payment, and bumps sponsorship totals. Real signature verification will
be added when we move beyond the sandbox.
"""

from __future__ import annotations

import hmac
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import select, text

from app.api.deps import DbSession
from app.core.config import settings
from app.models.donor import Donor
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
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


@router.post("/myfatoorah")
async def myfatoorah_webhook(
    payload: dict[str, Any],
    db: DbSession,
    x_myfatoorah_signature: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Receive payment status updates from MyFatoorah.

    Authenticates by comparing a shared-secret header against
    `MYFATOORAH_WEBHOOK_SECRET`. The handler is idempotent: a webhook
    delivered twice for the same `gateway_transaction_id` only inserts the
    payment row once.
    """
    expected = getattr(settings, "MYFATOORAH_WEBHOOK_SECRET", None)
    if expected:
        if x_myfatoorah_signature is None or not hmac.compare_digest(
            x_myfatoorah_signature, expected
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

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
        # Without a donor we can't satisfy the payments.donor_id NOT NULL
        # constraint, so reject early but with a clear message so the
        # gateway operator can re-link.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not match payment to a known donor or sponsorship",
        )

    # Scope subsequent queries by the donor's organization (RLS)
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
    from decimal import Decimal

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
    await db.commit()
    await db.refresh(payment)

    return {
        "status": "ok",
        "payment_id": str(payment.id),
        "payment_status": our_status,
    }
