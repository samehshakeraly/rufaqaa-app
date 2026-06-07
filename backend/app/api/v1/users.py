"""Admin user management — list, suspend, reactivate, invite.

Role-change still pending a firmer permission story.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.config import settings
from app.core.exceptions import NotFound
from app.core.security import (
    create_invite_token,
    decode_invite_token,
    hash_password,
)
from app.models.organization import Organization
from app.models.partner import PartnerOrganization
from app.models.session import UserSession
from app.models.user import User
from app.schemas.common import Page
from app.schemas.user_admin import UserAdminRead
from app.services.audit import record_audit
from app.services.email import send_templated

router = APIRouter()


class UserInvite(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    role: str = Field(min_length=1, max_length=50)
    # Optional جهة link. When set it must belong to the caller's org (checked
    # below). Foundation only — not restricted by role here.
    partner_organization_id: UUID | None = None


class UserInviteResponse(BaseModel):
    user: UserAdminRead
    invite_token: str
    expires_in_days: int


class AcceptInvite(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    # Present-and-null clears the assignment; an omitted key leaves it
    # untouched (the orphanage-update convention).
    partner_organization_id: UUID | None = None


async def _assert_partner_org_in_org(
    db: AsyncSession, partner_organization_id: UUID, organization_id: UUID
) -> None:
    """Reject a ``partner_organization_id`` that does not belong to ``organization_id``.

    Mirrors the org-scoped ownership check in
    ``services/orphans._assert_orphanage_in_org``: we validate explicitly rather
    than trust RLS (a Postgres superuser connection bypasses it, so a cross-org
    id would otherwise be silently accepted). Shared by invite + update.
    """
    owned = await db.scalar(
        select(PartnerOrganization.id).where(
            PartnerOrganization.id == partner_organization_id,
            PartnerOrganization.organization_id == organization_id,
        )
    )
    if owned is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="partner_organization_id does not reference a partner organization in this organization",
        )


@router.get("", response_model=Page[UserAdminRead])
async def list_users(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    role: str | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[UserAdminRead]:
    stmt = select(User).where(User.deleted_at.is_(None))
    if role:
        stmt = stmt.where(User.role == role)
    if status_filter:
        stmt = stmt.where(User.status == status_filter)

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[UserAdminRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


_INVITE_TTL_DAYS = 7


@router.post("/invite", response_model=UserInviteResponse, status_code=status.HTTP_201_CREATED)
async def invite_user(
    payload: UserInvite,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> UserInviteResponse:
    """Create a pending user and mint a one-shot invite token.

    The token is returned in the response — the caller is responsible for
    delivering it (email, copy/paste, etc). Until accepted, the user has
    an unusable random password and `status="pending_verification"`."""
    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists",
        )
    if payload.partner_organization_id is not None:
        await _assert_partner_org_in_org(db, payload.partner_organization_id, user.organization_id)
    invited = User(
        organization_id=user.organization_id,
        email=payload.email,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role=payload.role,
        status="pending_verification",
        partner_organization_id=payload.partner_organization_id,
    )
    db.add(invited)
    await db.flush()
    token = create_invite_token(invited.id, expires_in_days=_INVITE_TTL_DAYS)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="user.invited",
        entity_type="user",
        entity_id=invited.id,
        new_values={"email": invited.email, "role": invited.role},
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(invited)

    # Best-effort email — when SMTP isn't wired the sender just logs.
    # The token still comes back in the API response either way.
    org = await db.scalar(select(Organization).where(Organization.id == user.organization_id))
    org_name = org.name_ar if org else "Rufaqaa"
    accept_url = f"{settings.APP_BASE_URL.rstrip('/')}/accept-invite?token={token}"
    send_templated(
        to=invited.email,
        template="user_invite",
        locale=settings.DEFAULT_LOCALE,
        first_name=invited.first_name,
        inviter_name=f"{user.first_name} {user.last_name}".strip() or user.email,
        org_name=org_name,
        accept_url=accept_url,
        expires_days=_INVITE_TTL_DAYS,
    )

    return UserInviteResponse(
        user=UserAdminRead.model_validate(invited),
        invite_token=token,
        expires_in_days=_INVITE_TTL_DAYS,
    )


@router.post("/accept-invite", response_model=UserAdminRead)
async def accept_invite(payload: AcceptInvite, db: DbSession) -> UserAdminRead:
    """Bind a password to a pending user. No auth required — possession
    of the (signed, expiring) token IS the proof."""
    try:
        user_id = decode_invite_token(payload.token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired invite token",
        ) from exc
    target = await db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if target is None:
        raise NotFound("User")
    if target.status != "pending_verification":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This invite has already been accepted",
        )
    target.password_hash = hash_password(payload.password)
    target.status = "active"
    target.email_verified_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=target.organization_id,
        user_id=target.id,
        action="user.invite_accepted",
        entity_type="user",
        entity_id=target.id,
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(target)
    return UserAdminRead.model_validate(target)


async def _load_user_or_404(db: AsyncSession, user_id: UUID, organization_id: UUID) -> User:
    """Load a non-deleted user in the caller's org, or 404.

    Scoped to ``organization_id`` explicitly rather than trusting RLS: the app
    connects as a Postgres superuser that bypasses RLS, so an id-only lookup
    would let an admin act on a user in another organization. Same org-ownership
    posture as ``_assert_partner_org_in_org``. Shared by suspend / reactivate /
    update.
    """
    target = await db.scalar(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
        )
    )
    if target is None:
        raise NotFound("User")
    return target


@router.post("/{user_id}/suspend", response_model=UserAdminRead)
async def suspend_user(
    user_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> UserAdminRead:
    """Mark a user as suspended and revoke all their refresh tokens.

    Refuses to suspend the caller (would lock the admin out of their
    own session immediately)."""
    if user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot suspend yourself",
        )
    target = await _load_user_or_404(db, user_id, user.organization_id)
    if target.status == "suspended":
        return UserAdminRead.model_validate(target)

    target.status = "suspended"

    # Kill every live refresh token so the next access-token expiry
    # logs the user out for good.
    sessions = (
        await db.scalars(
            select(UserSession).where(
                UserSession.user_id == target.id,
                UserSession.revoked_at.is_(None),
            )
        )
    ).all()
    now = datetime.now(UTC)
    for s in sessions:
        s.revoked_at = now

    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="user.suspended",
        entity_type="user",
        entity_id=target.id,
        new_values={"email": target.email, "revoked_sessions": len(sessions)},
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(target)
    return UserAdminRead.model_validate(target)


@router.post("/{user_id}/reactivate", response_model=UserAdminRead)
async def reactivate_user(
    user_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> UserAdminRead:
    """Flip a suspended user back to active. Their refresh tokens stay
    revoked — they'll need to log in again."""
    target = await _load_user_or_404(db, user_id, user.organization_id)
    if target.status != "suspended":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Can only reactivate suspended users (current: {target.status})",
        )
    target.status = "active"
    target.failed_login_attempts = 0
    target.locked_until = None
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="user.reactivated",
        entity_type="user",
        entity_id=target.id,
        new_values={"email": target.email},
    )
    await db.commit()
    await db.refresh(target)
    return UserAdminRead.model_validate(target)


@router.patch("/{user_id}", response_model=UserAdminRead)
async def update_user(
    user_id: UUID,
    payload: UserUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> UserAdminRead:
    """Patch a user's mutable admin fields.

    Scoped for now to the partner organization (جهة) link — the foundation for
    partner-scoped users. Mirrors ``update_orphanage``: a present, non-null
    ``partner_organization_id`` is validated for org ownership before
    assignment; a present null clears it; an omitted key leaves it untouched.
    Purely additive — no role restriction or visibility logic here.
    """
    target = await _load_user_or_404(db, user_id, user.organization_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("partner_organization_id") is not None:
        await _assert_partner_org_in_org(
            db, updates["partner_organization_id"], user.organization_id
        )
    for field, value in updates.items():
        setattr(target, field, value)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="user.updated",
        entity_type="user",
        entity_id=target.id,
        # mode="json" keeps the audit JSONB-safe — partner_organization_id is a
        # UUID rather than a plain string.
        new_values=payload.model_dump(exclude_unset=True, mode="json"),
    )
    await db.commit()
    await db.refresh(target)
    return UserAdminRead.model_validate(target)
