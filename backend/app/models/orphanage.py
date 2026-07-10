from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Orphanage(Base):
    __tablename__ = "orphanages"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    partner_organization_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("partner_organizations.id")
    )
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    name_ar: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)

    country_code: Mapped[str | None] = mapped_column(String(2))
    governorate: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    district: Mapped[str | None] = mapped_column(String(100))
    address_details: Mapped[str | None] = mapped_column(Text)
    # coordinates (POINT) is intentionally not mapped — mirrors Family, which
    # omits the geo column rather than inventing a PostGIS ORM mapping.

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    # How many residents the dar can house; NULL = not recorded. The DB CHECK
    # (orphanages_capacity_check) mirrors the schema-level ge=0 bound.
    capacity: Mapped[int | None] = mapped_column(Integer)

    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))

    # The orphanage_manager who runs this dar. UNIQUE in the DB (one dar per
    # manager); NULL = no manager assigned yet.
    manager_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), unique=True
    )
