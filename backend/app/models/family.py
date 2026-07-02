from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, LargeBinary, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Family(Base):
    __tablename__ = "families"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    partner_organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("partner_organizations.id")
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    family_name: Mapped[str | None] = mapped_column(String(255))
    deceased_father_name: Mapped[str | None] = mapped_column(String(255))
    father_death_date: Mapped[date | None] = mapped_column(Date)
    father_death_cause: Mapped[str | None] = mapped_column(String(255))

    country_code: Mapped[str | None] = mapped_column(String(2))
    governorate: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    district: Mapped[str | None] = mapped_column(String(100))
    address_details: Mapped[str | None] = mapped_column(Text)
    # Finer-grained address (see migration 0021), alongside the broader
    # governorate/city/district above.
    village: Mapped[str | None] = mapped_column(String(100))
    street: Mapped[str | None] = mapped_column(String(255))
    house_number: Mapped[str | None] = mapped_column(String(20))
    floor: Mapped[str | None] = mapped_column(String(20))

    monthly_income: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    income_currency: Mapped[str | None] = mapped_column(String(3))
    housing_status: Mapped[str | None] = mapped_column(String(50))

    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))


class Guardian(Base):
    __tablename__ = "guardians"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    family_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("families.id"))
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), unique=True
    )

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # ``national_id`` is encrypted at rest into ``national_id_encrypted`` (BYTEA
    # Fernet token) by the write path (see app.core.crypto / api.v1.families);
    # the original plaintext column was dropped in 0020 once encryption fully
    # replaced it. Unlike the orphan, the guardian national_id IS exposed via
    # ``GuardianRead``, so those staff endpoints decrypt it on read — the
    # ciphertext is never serialised.
    national_id_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(1))

    relation: Mapped[str] = mapped_column(String(50), nullable=False)
    # Staff-facing only (see migration 0027) — never exposed on any donor
    # surface in this batch.
    occupation: Mapped[str | None] = mapped_column(String(100))

    phone: Mapped[str | None] = mapped_column(String(30))
    whatsapp: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))

    literacy_level: Mapped[str] = mapped_column(String(20), default="low")
    preferred_communication: Mapped[str] = mapped_column(String(20), default="whatsapp")

    bank_account_info: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="active")

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
