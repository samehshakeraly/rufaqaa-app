from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    donor_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("donors.id"), nullable=False
    )
    sponsorship_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("sponsorships.id")
    )
    orphan_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("orphans.id"))

    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_in_default_currency: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    exchange_rate: Mapped[Decimal | None] = mapped_column(Numeric(15, 6))

    payment_method: Mapped[str] = mapped_column(String(50), nullable=False)
    payment_gateway: Mapped[str | None] = mapped_column(String(50))

    gateway_transaction_id: Mapped[str | None] = mapped_column(String(255))
    bank_reference: Mapped[str | None] = mapped_column(String(255))

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    initiated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    processed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)

    receipt_number: Mapped[str | None] = mapped_column(String(50))
    receipt_issued_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    receipt_url: Mapped[str | None] = mapped_column(String(500))

    source_type: Mapped[str | None] = mapped_column(String(50))
    source_id: Mapped[str | None] = mapped_column(String(255))
    # R7: lets a FUTURE one-time donation point at a wish/need (coded
    # target_type 'wish'/'need' + the row's id). Nullable, no FK/CHECK —
    # validated in Pydantic when R8 wires the donation flow; NULL on every
    # existing flow.
    target_type: Mapped[str | None] = mapped_column(String(20))
    target_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    acquisition_channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("marketing_channels.id")
    )

    payment_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    # Admin who started the hosted-checkout on behalf of a present
    # donor. NULL on donor self-initiated payments.
    initiated_by_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
