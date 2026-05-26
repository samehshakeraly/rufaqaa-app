"""Marketing channels — the acquisition sources (committees, digital ads,
branches…) that bring in donors and orphan cases. Light CRUD; rules
around assignment quotas live elsewhere."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.partner import MarketingChannel
from app.models.user import User
from app.schemas.common import Page
from app.schemas.marketing_channel import (
    MarketingChannelCreate,
    MarketingChannelRead,
    MarketingChannelUpdate,
)
from app.services.audit import record_audit

router = APIRouter()


@router.get("", response_model=Page[MarketingChannelRead])
async def list_marketing_channels(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    include_inactive: bool = False,
) -> Page[MarketingChannelRead]:
    stmt = select(MarketingChannel)
    if not include_inactive:
        stmt = stmt.where(MarketingChannel.status == "active")
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(MarketingChannel.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[MarketingChannelRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=MarketingChannelRead, status_code=status.HTTP_201_CREATED)
async def create_marketing_channel(
    payload: MarketingChannelCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> MarketingChannelRead:
    channel = MarketingChannel(
        organization_id=user.organization_id,
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        channel_type=payload.channel_type,
        description=payload.description,
        status="active",
    )
    db.add(channel)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="marketing_channel.created",
        entity_type="marketing_channel",
        entity_id=channel.id,
        new_values={"name_ar": channel.name_ar, "channel_type": channel.channel_type},
    )
    await db.commit()
    await db.refresh(channel)
    return MarketingChannelRead.model_validate(channel)


@router.get("/{channel_id}", response_model=MarketingChannelRead)
async def get_marketing_channel(
    channel_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> MarketingChannelRead:
    channel = await db.scalar(select(MarketingChannel).where(MarketingChannel.id == channel_id))
    if channel is None:
        raise NotFound("Marketing channel")
    return MarketingChannelRead.model_validate(channel)


@router.patch("/{channel_id}", response_model=MarketingChannelRead)
async def update_marketing_channel(
    channel_id: UUID,
    payload: MarketingChannelUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> MarketingChannelRead:
    channel = await db.scalar(select(MarketingChannel).where(MarketingChannel.id == channel_id))
    if channel is None:
        raise NotFound("Marketing channel")
    changes: dict = {}
    for field in ("name_ar", "name_en", "channel_type", "description", "status"):
        v = getattr(payload, field)
        if v is not None:
            changes[field] = {"old": getattr(channel, field), "new": v}
            setattr(channel, field, v)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="marketing_channel.updated",
        entity_type="marketing_channel",
        entity_id=channel.id,
        old_values={k: v["old"] for k, v in changes.items()},
        new_values={k: v["new"] for k, v in changes.items()},
    )
    await db.commit()
    await db.refresh(channel)
    return MarketingChannelRead.model_validate(channel)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_marketing_channel(
    channel_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    channel = await db.scalar(select(MarketingChannel).where(MarketingChannel.id == channel_id))
    if channel is None:
        raise NotFound("Marketing channel")
    channel.status = "archived"
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="marketing_channel.archived",
        entity_type="marketing_channel",
        entity_id=channel.id,
        is_sensitive=True,
    )
    await db.commit()
