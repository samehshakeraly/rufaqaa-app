"""Moderated messaging between donors and guardians about orphans.

Privacy posture:

  * The wire representation never exposes raw `user_id`, email, phone, or
    last name. Every projection carries only `from_role` + `from_name`
    (first name only) and the same for the recipient.
  * Every message lands as `moderation_status='pending'`. The recipient
    cannot see it until a moderator approves; the **sender** sees it the
    whole time so they know it's in review.
  * Rejected messages are not deleted — the row stays for dispute trail.
    Sender + moderators see them; recipient never does.

Role gating mirrors the media-moderation set so the same humans who
clear photos also clear messages.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import ADMIN_ROLES, require_roles
from app.models.message import Message
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.common import Page
from app.services.audit import record_audit

router = APIRouter()


# Mirrors media moderation — the same humans who clear photos clear
# messages. partner_staff sends/uploads; they don't approve.
MESSAGE_MODERATOR_ROLES: tuple[str, ...] = ("partner_manager", *ADMIN_ROLES)

# Only these roles are allowed to initiate a conversation. Staff don't
# send messages via this surface (they have their own admin channels).
SENDER_ROLES: tuple[str, ...] = ("donor", "guardian")

# Max content length for the donor sponsorship-scoped compose surface (PR-9).
# Kept here so the constant lives with the messages domain and any caller
# (e.g. the donor portal router) imports a single source of truth.
MESSAGE_MAX_LEN = 2000


# ── Schemas ────────────────────────────────────────────────────────────


class MessageCreate(BaseModel):
    """Send payload — recipient and orphan are required so we always have
    a moderation handle and a context."""

    to_user_id: UUID
    related_orphan_id: UUID
    content: str = Field(min_length=1, max_length=4000)
    message_type: Literal["text"] = "text"
    related_sponsorship_id: UUID | None = None


class MessageModerate(BaseModel):
    decision: Literal["approve", "reject"]
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _reject_requires_reason(self) -> MessageModerate:
        """A reject decision must carry a non-empty reason so the sender
        learns why (the note is shown to them). Approve stays optional."""
        if self.decision == "reject" and not (self.notes and self.notes.strip()):
            raise ValueError("A moderation reason is required to reject a message")
        return self


class MessageRead(BaseModel):
    """Public projection.

    Deliberately omits `from_user_id`, `to_user_id`, emails, phones,
    last names. Only the calling user's relationship to the message
    (`is_mine`) and the counter-party's display name are exposed.
    """

    model_config = ConfigDict(from_attributes=False)

    id: UUID
    from_role: str
    from_name: str
    to_role: str
    to_name: str
    orphan_code: str | None
    message_type: str
    content: str | None
    moderation_status: str
    moderation_notes: str | None
    is_read: bool
    is_mine: bool
    created_at: datetime
    moderated_at: datetime | None
    read_at: datetime | None


# ── Helpers ────────────────────────────────────────────────────────────


async def _project(msg: Message, viewer: User, db: AsyncSession) -> MessageRead:
    """Convert a Message ORM row into the privacy-safe wire shape.

    Loads sender/recipient first-name + role and the orphan code in a
    handful of small queries; messages are rendered one at a time in
    short threads, so this stays acceptable.
    """
    from_row = (
        await db.execute(select(User.first_name, User.role).where(User.id == msg.from_user_id))
    ).first()
    to_row = (
        await db.execute(select(User.first_name, User.role).where(User.id == msg.to_user_id))
    ).first()

    orphan_code: str | None = None
    if msg.related_orphan_id is not None:
        orphan_code = await db.scalar(select(Orphan.code).where(Orphan.id == msg.related_orphan_id))

    return MessageRead(
        id=msg.id,
        from_role=str(from_row[1]) if from_row else "unknown",
        from_name=str(from_row[0]) if from_row else "",
        to_role=str(to_row[1]) if to_row else "unknown",
        to_name=str(to_row[0]) if to_row else "",
        orphan_code=orphan_code,
        message_type=msg.message_type,
        content=msg.content,
        moderation_status=msg.moderation_status,
        moderation_notes=msg.moderation_notes if _can_see_notes(msg, viewer) else None,
        is_read=bool(msg.is_read),
        is_mine=msg.from_user_id == viewer.id,
        created_at=msg.created_at,
        moderated_at=msg.moderated_at,
        read_at=msg.read_at,
    )


def _can_see_notes(msg: Message, viewer: User) -> bool:
    """Moderator notes are visible to moderators and to the sender (so
    they understand why a reject happened). Recipients don't see them."""
    if viewer.role in MESSAGE_MODERATOR_ROLES:
        return True
    return msg.from_user_id == viewer.id


def _is_moderator(user: User) -> bool:
    return user.role in MESSAGE_MODERATOR_ROLES or user.role == "super_admin"


def _viewer_can_see(msg: Message, viewer: User) -> bool:
    """Visibility check used by GET / list / read.

    - moderators see everything in their org (RLS already scopes by org)
    - sender sees every status (so they know their pending/rejected msg)
    - recipient sees only approved messages
    """
    if _is_moderator(viewer):
        return True
    if msg.from_user_id == viewer.id:
        return True
    if msg.to_user_id == viewer.id and msg.moderation_status == "approved":
        return True
    return False


# ── Endpoints ──────────────────────────────────────────────────────────


@router.post("", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def send_message(
    payload: MessageCreate,
    db: DbSession,
    user: CurrentUser,
) -> MessageRead:
    """Send a new message. Lands as `pending` — recipient won't see it
    until a moderator approves.

    Only donors and guardians may initiate via this surface. Staff
    workflows go through the admin channels.
    """
    if user.role not in SENDER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only donors and guardians can send messages here",
        )

    # Recipient + orphan must belong to the caller's org. Resolve both via the
    # org-scoped helper — the app's superuser DB connection bypasses RLS, so
    # without an explicit organization_id filter a message could target another
    # org's user or orphan. A cross-org (or missing/deleted) id 404s here.
    await get_in_org_or_404(db, User, payload.to_user_id, user, User.deleted_at.is_(None))
    await get_in_org_or_404(
        db, Orphan, payload.related_orphan_id, user, Orphan.deleted_at.is_(None)
    )

    msg = Message(
        organization_id=user.organization_id,
        from_user_id=user.id,
        to_user_id=payload.to_user_id,
        related_orphan_id=payload.related_orphan_id,
        related_sponsorship_id=payload.related_sponsorship_id,
        message_type=payload.message_type,
        content=payload.content,
        moderation_status="pending",
    )
    db.add(msg)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="message.sent",
        entity_type="message",
        entity_id=msg.id,
        new_values={
            "to_user_id": str(payload.to_user_id),
            "related_orphan_id": str(payload.related_orphan_id),
            "message_type": payload.message_type,
        },
    )
    await db.commit()
    await db.refresh(msg)
    return await _project(msg, user, db)


@router.get("", response_model=Page[MessageRead])
async def list_messages(
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    orphan_id: UUID | None = None,
    unread_only: bool = False,
) -> Page[MessageRead]:
    """List messages the caller can see.

    Moderators get everything in their org; everyone else sees only
    messages where they're sender (any status) or recipient (approved
    only). Use `orphan_id` to narrow to one conversation; `unread_only`
    filters to incoming approved+unread.
    """
    # Explicit org scope on the base statement — the app's superuser DB
    # connection bypasses RLS, so without this a moderator would see every
    # org's messages. Non-moderators are narrowed to their own rows below
    # (already in-org, since a user belongs to a single org).
    stmt = select(Message).where(Message.organization_id == user.organization_id)
    if not _is_moderator(user):
        # Sender sees any status; recipient sees only approved.
        stmt = stmt.where(
            or_(
                Message.from_user_id == user.id,
                (Message.to_user_id == user.id) & (Message.moderation_status == "approved"),
            )
        )
    if orphan_id is not None:
        stmt = stmt.where(Message.related_orphan_id == orphan_id)
    if unread_only:
        stmt = stmt.where(
            Message.to_user_id == user.id,
            Message.moderation_status == "approved",
            Message.is_read.is_(False),
        )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[await _project(r, user, db) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/pending", response_model=Page[MessageRead])
async def list_pending_messages(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*MESSAGE_MODERATOR_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[MessageRead]:
    """Moderation queue. Returns the caller-org's pending messages, newest
    first.

    A partner-scoped moderator (``partner_manager`` bound to a single جهة) sees
    ONLY the messages about that جهة's orphans — the review queue belongs to the
    orphanage (عبر الدار). Admins / super_admin keep the org-wide queue.
    """
    # Explicit org scope — the superuser DB connection bypasses RLS, so the
    # organization_id filter (not RLS) is what keeps the queue per-tenant.
    stmt = select(Message).where(
        Message.organization_id == user.organization_id,
        Message.moderation_status == "pending",
    )
    # Additive narrowing for a جهة-bound manager: restrict to messages whose
    # related orphan belongs to that partner org. Admins are unaffected.
    if user.role == "partner_manager" and user.partner_organization_id is not None:
        partner_orphan_ids = select(Orphan.id).where(
            Orphan.partner_organization_id == user.partner_organization_id
        )
        stmt = stmt.where(Message.related_orphan_id.in_(partner_orphan_ids))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[await _project(r, user, db) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{message_id}", response_model=MessageRead)
async def get_message(message_id: UUID, db: DbSession, user: CurrentUser) -> MessageRead:
    msg = await get_in_org_or_404(db, Message, message_id, user)
    if not _viewer_can_see(msg, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a participant in this conversation",
        )
    return await _project(msg, user, db)


@router.post("/{message_id}/read", response_model=MessageRead)
async def mark_message_read(message_id: UUID, db: DbSession, user: CurrentUser) -> MessageRead:
    """Mark a message as read by the calling user.

    Only the recipient may mark; only approved messages can be marked
    (anything else hasn't been delivered yet). Idempotent — re-reading
    leaves `read_at` at the first mark.
    """
    msg = await get_in_org_or_404(db, Message, message_id, user)
    if msg.to_user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the recipient can mark a message read",
        )
    if msg.moderation_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Message is not yet visible (awaiting moderation)",
        )
    if not msg.is_read:
        msg.is_read = True
        msg.read_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(msg)
    return await _project(msg, user, db)


@router.post("/{message_id}/moderate", response_model=MessageRead)
async def moderate_message(
    message_id: UUID,
    payload: MessageModerate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*MESSAGE_MODERATOR_ROLES))],
) -> MessageRead:
    """Approve or reject a pending message.

    Reject doesn't delete — the row stays so disputes have an audit
    trail. Sender keeps seeing it (with the reject note); the recipient
    never does.
    """
    # Org-scope the fetch via the helper — moderators only act on their own
    # org's messages (superuser conn bypasses RLS); a cross-org id 404s before
    # the status check, so another org's message is never moderated.
    msg = await get_in_org_or_404(db, Message, message_id, user)
    if msg.moderation_status not in ("pending",):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Message is in moderation_status '{msg.moderation_status}', expected 'pending'"
            ),
        )

    old_status = msg.moderation_status
    new_status = "approved" if payload.decision == "approve" else "rejected"
    msg.moderation_status = new_status
    msg.moderated_by = user.id
    msg.moderated_at = datetime.now(UTC)
    msg.moderation_notes = payload.notes

    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="message.moderated",
        entity_type="message",
        entity_id=msg.id,
        old_values={"moderation_status": old_status},
        new_values={"moderation_status": new_status, "decision": payload.decision},
    )
    await db.commit()
    await db.refresh(msg)
    return await _project(msg, user, db)
