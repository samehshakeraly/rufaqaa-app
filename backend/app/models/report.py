from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrphanReport(Base):
    __tablename__ = "orphan_reports"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    orphan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("orphans.id", ondelete="CASCADE"),
        nullable=False,
    )

    report_type: Mapped[str] = mapped_column(String(30), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)

    educational_progress: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    quran_progress: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    activities: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    health_status: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    psychological_status: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    summary: Mapped[str | None] = mapped_column(Text)

    # Per-section donor visibility. A section is shown to donors UNLESS its key
    # ("education"/"quran"/"activities"/"health"/"psychological") is explicitly
    # False; an empty map ⇒ everything visible (the product default).
    section_visibility: Mapped[dict[str, bool]] = mapped_column(JSONB, nullable=False, default=dict)
    # Warm note from the supervisor to the sponsor, surfaced in the donor view.
    donor_message: Mapped[str | None] = mapped_column(Text)
    # Highlight flag + localized label for milestone reports (e.g. finished a juz).
    is_milestone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    milestone_label: Mapped[str | None] = mapped_column(Text)

    photos_count: Mapped[int] = mapped_column(Integer, default=0)
    videos_count: Mapped[int] = mapped_column(Integer, default=0)
    documents_count: Mapped[int] = mapped_column(Integer, default=0)

    status: Mapped[str] = mapped_column(String(30), default="draft")

    submitted_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    submitted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    partner_approved_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    partner_approved_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    org_approved_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    org_approved_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    published_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    donors_notified_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    rejection_reason: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now()
    )
