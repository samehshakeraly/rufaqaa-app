from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, String, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name_ar: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)

    org_type: Mapped[str] = mapped_column(String(50), nullable=False)
    deployment_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="self_hosted")

    country_code: Mapped[str] = mapped_column(String(2), nullable=False)
    timezone: Mapped[str] = mapped_column(String(50), default="Asia/Kuwait")
    default_language: Mapped[str] = mapped_column(String(5), default="ar")
    default_currency: Mapped[str] = mapped_column(String(3), default="KWD")

    logo_url: Mapped[str | None] = mapped_column(String(500))
    primary_color: Mapped[str] = mapped_column(String(7), default="#769FCD")

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    subscription_plan: Mapped[str | None] = mapped_column(String(20), default="free")
    subscription_expires_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    settings: Mapped[dict] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))

    __table_args__ = (CheckConstraint("primary_color ~* '^#[0-9A-F]{6}$'", name="valid_color"),)
