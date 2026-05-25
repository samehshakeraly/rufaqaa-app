from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Sponsorship(Base):
    __tablename__ = "sponsorships"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    donor_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("donors.id"), nullable=False
    )
    orphan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphans.id"), nullable=False
    )
    marketing_channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("marketing_channels.id")
    )

    monthly_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)

    payment_frequency: Mapped[str] = mapped_column(String(20), default="monthly")
    payment_method: Mapped[str | None] = mapped_column(String(30))
    next_payment_date: Mapped[date | None] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")

    total_paid: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    payments_count: Mapped[int] = mapped_column(Integer, default=0)
    last_payment_date: Mapped[date | None] = mapped_column(Date)
    last_payment_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    months_overdue: Mapped[int] = mapped_column(Integer, default=0)

    acquisition_source: Mapped[str | None] = mapped_column(String(100))
    acquisition_campaign: Mapped[str | None] = mapped_column(String(100))

    cancelled_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)

    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
