"""ORM mapping for the ``orphan_skills`` table (migration 0029).

One row per skill or talent a staff member records for a child. Mirrors the
Media model's org/orphan FK pattern: tenant-owned via ``organization_id``
(every query filters it EXPLICITLY — the app's superuser connection bypasses
RLS) and cascades away with its orphan. ``note`` is STAFF-ONLY free text; the
donor composition only ever projects name/category/level.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrphanSkill(Base):
    __tablename__ = "orphan_skills"
    __table_args__ = (Index("idx_orphan_skills_org_orphan", "organization_id", "orphan_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )
    orphan_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphans.id", ondelete="CASCADE"), nullable=False
    )

    name: Mapped[str] = mapped_column(String(60), nullable=False)
    # Coded qualifiers (SkillCategory / SkillLevel Literals at the Pydantic
    # boundary; no DB CHECK — the health_status pattern). Donor-visible.
    category: Mapped[str | None] = mapped_column(String(30))
    level: Mapped[str | None] = mapped_column(String(20))
    # STAFF-ONLY free text — never projected onto any donor surface.
    note: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
