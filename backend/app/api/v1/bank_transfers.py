"""Bank transfers — periodic payouts from the org to a partner.

Workflow: an admin creates a transfer in `pending`, an admin approves
(→ `approved`), an admin marks it executed (→ `completed`), and
optionally the partner confirms receipt later. Each transition is
audited; no state can be reached except via the dedicated endpoints.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.bank_transfer import BankTransfer
from app.models.partner import PartnerOrganization
from app.models.user import User
from app.schemas.bank_transfer import (
    BankTransferConfirmReceipt,
    BankTransferCreate,
    BankTransferRead,
)
from app.schemas.common import Page
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[BankTransferRead])
async def list_bank_transfers(
    db: DbSession,
    _user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    partner_id: UUID | None = None,
) -> Page[BankTransferRead]:
    stmt = select(BankTransfer)
    if status_filter:
        stmt = stmt.where(BankTransfer.status == status_filter)
    if partner_id:
        stmt = stmt.where(BankTransfer.partner_organization_id == partner_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(desc(BankTransfer.created_at)).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[BankTransferRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=BankTransferRead, status_code=status.HTTP_201_CREATED)
async def create_bank_transfer(
    payload: BankTransferCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> BankTransferRead:
    if payload.period_end < payload.period_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="period_end must be on or after period_start",
        )
    partner = await db.scalar(
        select(PartnerOrganization).where(PartnerOrganization.id == payload.partner_organization_id)
    )
    if partner is None:
        raise NotFound("Partner")

    transfer = BankTransfer(
        organization_id=user.organization_id,
        code=generate_code("TRF"),
        partner_organization_id=payload.partner_organization_id,
        amount=payload.amount,
        currency=payload.currency,
        bank_name=payload.bank_name,
        bank_reference=payload.bank_reference,
        period_start=payload.period_start,
        period_end=payload.period_end,
        notes=payload.notes,
        status="pending",
    )
    db.add(transfer)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="bank_transfer.created",
        entity_type="bank_transfer",
        entity_id=transfer.id,
        new_values={
            "code": transfer.code,
            "partner_id": str(payload.partner_organization_id),
            "amount": str(payload.amount),
            "currency": payload.currency,
        },
    )
    await db.commit()
    await db.refresh(transfer)
    return BankTransferRead.model_validate(transfer)


async def _load_or_404(db: AsyncSession, transfer_id: UUID) -> BankTransfer:
    transfer = await db.scalar(select(BankTransfer).where(BankTransfer.id == transfer_id))
    if transfer is None:
        raise NotFound("Bank transfer")
    return transfer


async def _transition(
    db: AsyncSession,
    user: User,
    transfer_id: UUID,
    allowed_from: tuple[str, ...],
    new_status: str,
    *,
    set_approved: bool = False,
    set_executed: bool = False,
    set_partner_confirmed: bool = False,
) -> BankTransfer:
    transfer = await _load_or_404(db, transfer_id)
    if transfer.status not in allowed_from:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot {new_status} from {transfer.status}; "
                f"allowed only from: {list(allowed_from)}"
            ),
        )
    old_status = transfer.status
    transfer.status = new_status
    now = datetime.now(UTC)
    if set_approved:
        transfer.approved_by = user.id
        transfer.approved_at = now
    if set_executed:
        transfer.executed_by = user.id
        transfer.executed_at = now
    if set_partner_confirmed:
        transfer.confirmed_by_partner_at = now
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action=f"bank_transfer.{new_status}",
        entity_type="bank_transfer",
        entity_id=transfer.id,
        old_values={"status": old_status},
        new_values={"status": new_status},
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(transfer)
    return transfer


@router.post("/{transfer_id}/approve", response_model=BankTransferRead)
async def approve_bank_transfer(
    transfer_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> BankTransferRead:
    transfer = await _transition(db, user, transfer_id, ("pending",), "approved", set_approved=True)
    return BankTransferRead.model_validate(transfer)


@router.post("/{transfer_id}/mark-completed", response_model=BankTransferRead)
async def mark_bank_transfer_completed(
    transfer_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> BankTransferRead:
    transfer = await _transition(
        db,
        user,
        transfer_id,
        ("approved", "processing"),
        "completed",
        set_executed=True,
    )
    return BankTransferRead.model_validate(transfer)


@router.post("/{transfer_id}/cancel", response_model=BankTransferRead)
async def cancel_bank_transfer(
    transfer_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> BankTransferRead:
    transfer = await _transition(
        db, user, transfer_id, ("pending", "approved", "processing"), "cancelled"
    )
    return BankTransferRead.model_validate(transfer)


@router.post("/{transfer_id}/confirm-receipt", response_model=BankTransferRead)
async def partner_confirm_receipt(
    transfer_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
    payload: BankTransferConfirmReceipt | None = None,
) -> BankTransferRead:
    """Acknowledge that the partner has received the funds. Stamps
    confirmed_by_partner_at; optionally attaches a proof document
    via confirmation_document_id and a free-text note. Does not
    change `status` — a transfer can be `completed` without partner
    confirmation."""
    transfer = await _load_or_404(db, transfer_id)
    if transfer.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Can only confirm receipt for completed transfers",
        )
    now = datetime.now(UTC)
    transfer.confirmed_by_partner_at = now
    if payload is not None:
        if payload.confirmation_document_id is not None:
            from app.models.document import Document

            doc = await db.scalar(
                select(Document).where(Document.id == payload.confirmation_document_id)
            )
            if doc is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Confirmation document not found",
                )
            transfer.confirmation_document_id = doc.id
        if payload.notes is not None and payload.notes.strip():
            existing = (transfer.notes or "").strip()
            stamp = now.date().isoformat()
            new_chunk = f"[{stamp} confirm-receipt] {payload.notes.strip()}"
            transfer.notes = f"{existing}\n{new_chunk}".strip() if existing else new_chunk
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="bank_transfer.partner_confirmed",
        entity_type="bank_transfer",
        entity_id=transfer.id,
        new_values={
            "confirmation_document_id": (
                str(transfer.confirmation_document_id)
                if transfer.confirmation_document_id
                else None
            ),
        },
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(transfer)
    return BankTransferRead.model_validate(transfer)
