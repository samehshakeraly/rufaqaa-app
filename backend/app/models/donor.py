from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Donor(Base):
    __tablename__ = "donors"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), unique=True
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name_en: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    whatsapp: Mapped[str | None] = mapped_column(String(30))

    nationality: Mapped[str | None] = mapped_column(String(2))
    country_of_residence: Mapped[str | None] = mapped_column(String(2))
    preferred_currency: Mapped[str | None] = mapped_column(String(3))

    kyc_status: Mapped[str] = mapped_column(String(20), default="not_required")
    kyc_completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    acquisition_channel: Mapped[str | None] = mapped_column(String(50))
    acquisition_channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("marketing_channels.id")
    )
    referred_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("donors.id"))

    total_sponsorships: Mapped[int] = mapped_column(Integer, default=0)
    active_sponsorships: Mapped[int] = mapped_column(Integer, default=0)
    total_donated: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_donated_currency: Mapped[str | None] = mapped_column(String(3))
    first_donation_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    last_donation_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    notification_channels: Mapped[list[str]] = mapped_column(JSONB, default=lambda: ["email"])
    communication_preferences: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    is_zakat_donor: Mapped[bool] = mapped_column(Boolean, default=False)

    status: Mapped[str] = mapped_column(String(20), default="active")

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
