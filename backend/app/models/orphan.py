from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Orphan(Base):
    __tablename__ = "orphans"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    partner_organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("partner_organizations.id"), nullable=False
    )
    family_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("families.id"))
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), unique=True
    )

    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(100))
    family_name: Mapped[str] = mapped_column(String(100), nullable=False)
    full_name_en: Mapped[str | None] = mapped_column(String(255))

    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)
    gender: Mapped[str] = mapped_column(String(1), nullable=False)
    nationality: Mapped[str | None] = mapped_column(String(2))

    birth_certificate_number: Mapped[str | None] = mapped_column(String(100))

    father_name: Mapped[str | None] = mapped_column(String(255))
    father_death_date: Mapped[date | None] = mapped_column(Date)
    father_death_certificate: Mapped[str | None] = mapped_column(String(100))

    case_status: Mapped[str] = mapped_column(String(30), default="pending_review")

    assigned_to_channel_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("marketing_channels.id")
    )
    assigned_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    assignment_deadline: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    approved_by_partner_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    approved_by_partner_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    is_sponsored: Mapped[bool] = mapped_column(Boolean, default=False)
    current_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    balance_currency: Mapped[str | None] = mapped_column(String(3))

    profile_completion_percentage: Mapped[int] = mapped_column(Integer, default=0)
    profile_completion_score: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
