"""ORM mapping for the ``orphan_needs`` table (migration 0031).

One row per concrete, donor-fundable material need a staff member records for
a child — the OrphanWish shape plus a coded ``category``
(rent/medicine/supplies/…). Mirrors the OrphanSkill org/orphan FK pattern:
tenant-owned via ``organization_id`` (every query filters it EXPLICITLY — the
app's superuser connection bypasses RLS) and cascades away with its orphan.

``internal_note`` is STAFF-ONLY free text; the donor composition only ever
projects the NeedCard allowlist. ``raised_amount`` is SYSTEM-managed — no R7
endpoint mutates it (only R8's payment webhook will). Money mirrors
``payments``: Numeric(10,2) + a 3-letter currency code.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrphanNeed(Base):
    __tablename__ = "orphan_needs"
    __table_args__ = (Index("idx_orphan_needs_org_orphan", "organization_id", "orphan_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    orphan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphans.id", ondelete="CASCADE"), nullable=False
    )

    title: Mapped[str] = mapped_column(String(120), nullable=False)
    # Donor-facing, staff-authored pitch.
    description: Mapped[str | None] = mapped_column(Text)
    # STAFF-ONLY free text — never projected onto any donor surface.
    internal_note: Mapped[str | None] = mapped_column(Text)
    # Coded qualifier (NeedCategory Literal at the Pydantic boundary; no DB
    # CHECK — the health_status pattern). Donor-visible.
    category: Mapped[str | None] = mapped_column(String(30))

    target_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # SYSTEM-managed — immutable in R7; only R8's webhook moves it.
    raised_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    # Coded (NeedStatus Literal at the Pydantic boundary; no DB CHECK — the
    # health_status pattern): open / met / archived.
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="open")

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
