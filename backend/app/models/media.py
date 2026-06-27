"""ORM mapping for the ``media`` table.

The table itself is defined in the canonical schema (``01_database_schema.sql``)
and was historically written/read through raw SQL in :mod:`app.api.v1.media`.
This model maps the FULL existing table plus the two columns added in migration
0024 (``category`` / ``display_date``) so the NEW, categorized-media endpoints
and the donor-profile composition can use the typed ORM. The legacy raw-SQL
endpoints keep working unchanged.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Media(Base):
    __tablename__ = "media"
    __table_args__ = (
        Index("idx_media_moderation", "organization_id", "moderation_status"),
        Index("idx_media_orphan", "orphan_id"),
        Index("idx_media_report", "report_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    orphan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphans.id", ondelete="CASCADE"), nullable=False
    )
    report_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphan_reports.id", ondelete="SET NULL")
    )

    media_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Donor-library category (migration 0024). NULL for legacy rows that predate
    # categorization; otherwise one of drawing/certificate/album/recitation/portrait.
    category: Mapped[str | None] = mapped_column(String(20))

    title: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)

    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    # Human caption date (migration 0024); the donor composition falls back to
    # ``created_at`` when this is NULL.
    display_date: Mapped[date | None] = mapped_column(Date)

    ai_moderation_status: Mapped[str | None] = mapped_column(String(20))
    ai_moderation_score: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    ai_moderation_flags: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    moderation_status: Mapped[str | None] = mapped_column(String(20))
    moderated_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    moderated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    moderation_notes: Mapped[str | None] = mapped_column(Text)

    visibility: Mapped[str | None] = mapped_column(String(20))
    has_guardian_consent: Mapped[bool | None] = mapped_column(Boolean)
    consent_document_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("documents.id")
    )

    uploaded_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
