from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Boolean, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Message(Base):
    """A moderated message between two users about an orphan or sponsorship.

    Schema-matched binding for the `messages` table (see
    docs/technical/01_database_schema.sql §16). Every message lands as
    `pending` and must be cleared by a moderator before the recipient
    can see it. Rejected messages stay on the row (visible to sender
    + moderators) — never hard-deleted, so disputes have an audit trail.
    """

    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )

    from_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    to_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    related_orphan_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("orphans.id")
    )
    related_sponsorship_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("sponsorships.id")
    )

    message_type: Mapped[str] = mapped_column(String(20), default="text")
    content: Mapped[str | None] = mapped_column(Text)
    media_url: Mapped[str | None] = mapped_column(String(500))

    moderation_status: Mapped[str] = mapped_column(String(20), default="pending")
    moderated_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    moderated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    moderation_notes: Mapped[str | None] = mapped_column(Text)

    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    read_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))

    detected_language: Mapped[str | None] = mapped_column(String(5))
    translations: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.now()
    )
