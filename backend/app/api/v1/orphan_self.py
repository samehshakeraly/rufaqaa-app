"""Orphan self-service endpoints under `/orphan`.

Mirrors the guardian/donor self-portal pattern (`guardian_self.py`,
`donor_self.py`): there is no `require_roles` on the dependency, because
the resource itself is the gate — only users that actually have an
`orphans.user_id` row pointing to them resolve. Anyone else gets a 404.

Privacy posture, hard-baked — this surface is the most sensitive in the
whole system, since the viewer is a *child*:

  * **Age gate.** The portal is only for orphans aged 12+. A provisioned
    under-12 account resolves its Orphan row but is then refused with
    403 `AGE_GATE` on every endpoint. We never expose the portal to
    under-12s by default.
  * **No donor identity, ever.** The "my sponsor" view returns only a
    generic display name (either the literal "كفيلك" or — when the org
    has opted in via `business_rules.show_donor_first_name_to_orphan` —
    the donor's first name) plus the year sponsorship started. It NEVER
    serialises donor id/email/phone/full name, amount, currency, or the
    sponsorship id.
  * **No financial figures.** `current_balance`, `monthly_amount`,
    partner identity, guardian PII and sponsorship status text are all
    omitted from every projection here.

The surface is read-only except for composing a message; orphan-sent
messages always land as `moderation_status='pending'` so a moderator
clears them before the recipient sees them.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.family import Guardian
from app.models.message import Message
from app.models.orphan import Orphan
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.services.audit import record_audit

router = APIRouter()

_log = structlog.get_logger("rufaqaa.orphan_self")

# Minimum age (years) to access the self-portal. Under this, the account
# may exist but the portal is refused — see `_resolve_orphan_or_403`.
MIN_PORTAL_AGE = 12

# Default fallback display name for the sponsor when the org has not
# opted into revealing the donor's first name. Arabic for "your sponsor".
DEFAULT_SPONSOR_DISPLAY_NAME = "كفيلك"


# ── Schemas ────────────────────────────────────────────────────────────


class OrphanMeRead(BaseModel):
    """The orphan's own profile.

    Deliberately omits every financial field (`current_balance`,
    `is_sponsored`, `balance_currency`), partner identity
    (`partner_organization_id`), and any guardian PII.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    first_name: str
    family_name: str
    date_of_birth: date
    gender: str
    profile_completion_percentage: int


class OrphanSponsorView(BaseModel):
    """Minimal, child-safe view of the sponsorship.

    When `has_sponsor` is False every other field is None. When True,
    `display_name` is either the literal "كفيلك" or the donor's first
    name (only if the org opted in), and `since_year` is the calendar
    year the sponsorship started. NEVER carries donor id/email/phone/
    full name, amount, currency, or sponsorship id.
    """

    has_sponsor: bool
    display_name: str | None = None
    since_year: int | None = None


class OrphanAchievementRead(BaseModel):
    """Published report, projected to the progress fields only.

    Drops everything financial, drops `health_status` and
    `psychological_status` (clinical), and drops `submitted_by` /
    approver user info.
    """

    id: UUID
    report_type: str
    period_start: date
    period_end: date
    educational_progress: dict[str, Any] | None = None
    quran_progress: dict[str, Any] | None = None
    activities: dict[str, Any] | None = None


class OrphanMessageCreate(BaseModel):
    """Compose payload. The orphan never picks the recipient or the
    orphan context — both are derived server-side (recipient = primary
    guardian, context = self)."""

    content: str = Field(min_length=1, max_length=4000)
    message_type: Literal["text"] = "text"


class OrphanMessageRead(BaseModel):
    """Privacy-safe message projection.

    Carries only `from_role` + `from_name` (first name) — no raw
    `from_user_id` / `to_user_id`, no email, phone, or last name.
    """

    id: UUID
    from_role: str
    from_name: str
    message_type: str
    content: str | None
    moderation_status: str
    is_read: bool
    is_mine: bool
    created_at: date | None = None


# ── Helpers ────────────────────────────────────────────────────────────


def _age_in_years(dob: date, today: date) -> int:
    """Whole years between `dob` and `today` (no leap-day surprises)."""
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


async def _resolve_orphan_or_403(db: AsyncSession, user: User) -> Orphan:
    """Resolve the calling user to their Orphan row and enforce the age gate.

    * 404 (not 403) for non-orphan users — we don't confirm that
      `/orphan/me` is reachable when you aren't one.
    * 403 `AGE_GATE` for a provisioned under-12 account — the row exists
      but the portal is off-limits.
    """
    orphan = await db.scalar(
        select(Orphan).where(Orphan.user_id == user.id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    if _age_in_years(orphan.date_of_birth, date.today()) < MIN_PORTAL_AGE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "AGE_GATE",
                "message": "The orphan self-portal is only available to orphans aged 12 and over.",
            },
        )
    return orphan


async def _show_donor_first_name_to_orphan(db: AsyncSession, organization_id: UUID) -> bool:
    """Read the per-org flag controlling whether the donor's first name
    may be shown to the orphan.

    No ORM model exists for `business_rules` (mirrors `guardian_self`);
    we hit it with raw SQL. Default FALSE — the column default and the
    privacy posture both say "show 'كفيلك', not a name".
    """
    row = (
        await db.execute(
            text(
                "SELECT show_donor_first_name_to_orphan FROM business_rules "
                "WHERE organization_id = :org_id LIMIT 1"
            ),
            {"org_id": str(organization_id)},
        )
    ).first()
    if row is None:
        return False
    return bool(row[0])


async def _primary_guardian_user_id(db: AsyncSession, orphan: Orphan) -> UUID | None:
    """Resolve the orphan's primary guardian's *user* id, if any.

    "Primary" is the earliest-created guardian in the orphan's family
    that has actually been provisioned a user account (so a message can
    be delivered). Returns None when the orphan has no family or no
    guardian with a login — the caller then leaves `to_user_id` NULL and
    a moderator routes the message manually.
    """
    if orphan.family_id is None:
        return None
    return await db.scalar(
        select(Guardian.user_id)
        .where(
            Guardian.family_id == orphan.family_id,
            Guardian.user_id.is_not(None),
        )
        .order_by(Guardian.created_at.asc())
        .limit(1)
    )


async def _project_message(msg: Message, viewer: User, db: AsyncSession) -> OrphanMessageRead:
    """Convert a Message ORM row into the child-safe wire shape.

    Only the sender's first name + role are exposed; recipient identity
    and all raw user ids stay server-side.
    """
    from_row = (
        await db.execute(select(User.first_name, User.role).where(User.id == msg.from_user_id))
    ).first()
    return OrphanMessageRead(
        id=msg.id,
        from_role=str(from_row[1]) if from_row else "unknown",
        from_name=str(from_row[0]) if from_row else "",
        message_type=msg.message_type,
        content=msg.content,
        moderation_status=msg.moderation_status,
        is_read=bool(msg.is_read),
        is_mine=msg.from_user_id == viewer.id,
        created_at=msg.created_at.date() if msg.created_at else None,
    )


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("/me", response_model=OrphanMeRead)
async def get_orphan_me(db: DbSession, user: CurrentUser) -> OrphanMeRead:
    """Return the orphan's own profile. No financial, partner, or
    guardian fields are serialised."""
    orphan = await _resolve_orphan_or_403(db, user)
    return OrphanMeRead.model_validate(orphan)


@router.get("/me/sponsor", response_model=OrphanSponsorView)
async def get_orphan_sponsor(db: DbSession, user: CurrentUser) -> OrphanSponsorView:
    """Minimal sponsor view.

    Returns `{has_sponsor: false}` when there is no active sponsorship.
    Otherwise returns a generic display name (the donor's first name only
    when the org has opted in) and the start year — never the donor's
    identity, the amount, the currency, or the sponsorship id.
    """
    orphan = await _resolve_orphan_or_403(db, user)

    sponsorship = await db.scalar(
        select(Sponsorship)
        .where(
            Sponsorship.orphan_id == orphan.id,
            Sponsorship.status == "active",
        )
        .order_by(Sponsorship.start_date.asc())
        .limit(1)
    )
    if sponsorship is None:
        return OrphanSponsorView(has_sponsor=False)

    # Snapshot every ORM attribute we still need into plain locals *now*,
    # before the optional lookup below. A failure there triggers a
    # rollback, which expires the `orphan` / `sponsorship` instances —
    # touching any of their attributes afterwards would fire a lazy reload
    # outside the async greenlet and raise all over again.
    since_year: int | None = sponsorship.start_date.year if sponsorship.start_date else None
    donor_id = sponsorship.donor_id
    organization_id = orphan.organization_id
    orphan_id_str = str(orphan.id)

    # Resolving the donor's first name is an OPTIONAL, opt-in enhancement
    # that reaches the `business_rules` table (raw SQL) and the donors
    # table. None of that must be allowed to 500 the whole sponsor view:
    # a failure here (e.g. a not-yet-migrated `business_rules` column, an
    # unreadable donor row) previously surfaced as an unhandled 500 that
    # bypassed CORS and looked like a CORS error in the browser. On ANY
    # such failure we degrade to the generic, privacy-safe display name.
    # CHILD-SAFETY: the fallback NEVER reveals donor identity.
    display_name = DEFAULT_SPONSOR_DISPLAY_NAME
    try:
        if await _show_donor_first_name_to_orphan(db, organization_id):
            # Only the first name — never the full name, and only when opted in.
            full_name = await db.scalar(select(Donor.full_name).where(Donor.id == donor_id))
            if full_name:
                display_name = str(full_name).split(" ", 1)[0]
    except SQLAlchemyError:
        # Reset the (now aborted) transaction and fall back safely.
        await db.rollback()
        _log.warning("sponsor_display_name_fallback", orphan_id=orphan_id_str)
        display_name = DEFAULT_SPONSOR_DISPLAY_NAME

    return OrphanSponsorView(
        has_sponsor=True,
        display_name=display_name,
        since_year=since_year,
    )


@router.get("/me/achievements", response_model=list[OrphanAchievementRead])
async def list_orphan_achievements(
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[OrphanAchievementRead]:
    """List the orphan's published reports, projected to progress fields.

    Only `published_to_donor` reports are returned — drafts and
    in-review reports stay hidden. Financial, clinical (`health_status`,
    `psychological_status`) and submitter fields are dropped.
    """
    orphan = await _resolve_orphan_or_403(db, user)

    rows = (
        await db.scalars(
            select(OrphanReport)
            .where(
                OrphanReport.orphan_id == orphan.id,
                OrphanReport.status == "published_to_donor",
            )
            .order_by(OrphanReport.period_start.desc())
            .limit(limit)
        )
    ).all()
    return [
        OrphanAchievementRead(
            id=r.id,
            report_type=r.report_type,
            period_start=r.period_start,
            period_end=r.period_end,
            educational_progress=r.educational_progress,
            quran_progress=r.quran_progress,
            activities=r.activities,
        )
        for r in rows
    ]


@router.post(
    "/me/messages",
    response_model=OrphanMessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_orphan_message(
    payload: OrphanMessageCreate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanMessageRead:
    """Compose a message.

    The orphan can only ever send a message with `related_orphan_id` set
    to their own id; the recipient auto-resolves to the orphan's primary
    guardian (or NULL when none has a login, in which case a moderator
    routes it). Every orphan-sent message lands as `pending`.
    """
    orphan = await _resolve_orphan_or_403(db, user)

    to_user_id = await _primary_guardian_user_id(db, orphan)

    msg = Message(
        organization_id=orphan.organization_id,
        from_user_id=user.id,
        to_user_id=to_user_id,
        related_orphan_id=orphan.id,
        message_type=payload.message_type,
        content=payload.content,
        moderation_status="pending",
    )
    db.add(msg)
    await db.flush()
    record_audit(
        db,
        organization_id=orphan.organization_id,
        user_id=user.id,
        action="message.sent",
        entity_type="message",
        entity_id=msg.id,
        new_values={
            "related_orphan_id": str(orphan.id),
            "to_user_id": str(to_user_id) if to_user_id else None,
            "message_type": payload.message_type,
        },
    )
    await db.commit()
    await db.refresh(msg)
    return await _project_message(msg, user, db)


@router.get("/me/messages", response_model=list[OrphanMessageRead])
async def list_orphan_messages(
    db: DbSession,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[OrphanMessageRead]:
    """List approved messages in the orphan's own thread.

    Scoped to `related_orphan_id == self.id` and to messages the orphan
    is actually a party to (sender or recipient). Only `approved`
    messages surface here."""
    orphan = await _resolve_orphan_or_403(db, user)

    rows = (
        await db.scalars(
            select(Message)
            .where(
                Message.related_orphan_id == orphan.id,
                Message.moderation_status == "approved",
                or_(
                    Message.from_user_id == user.id,
                    Message.to_user_id == user.id,
                ),
            )
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [await _project_message(r, user, db) for r in rows]
