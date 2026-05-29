"""Marketing channels — the acquisition sources (committees, digital ads,
branches…) that bring in donors and orphan cases. Light CRUD; rules
around assignment quotas live elsewhere."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, MARKETING_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.partner import MarketingChannel
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.marketing_channel import (
    ChannelProgress,
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


def _pct(achieved: float, goal: float | None) -> float:
    """Completion percentage, rounded to 2 dp. 0.0 when no goal is set
    (avoids divide-by-zero and a misleading 100%)."""
    if not goal:
        return 0.0
    return round(achieved / goal * 100, 2)


@router.get("/{channel_id}/progress", response_model=ChannelProgress)
async def channel_progress(
    channel_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*MARKETING_ROLES))],
) -> ChannelProgress:
    """Goal-vs-achieved progress for a channel's annual targets.

    Achievement is measured within the channel's `goal_year` (falling back
    to the current calendar year when the row has none set): non-cancelled
    sponsorships acquired through the channel, and completed payments on
    those sponsorships."""
    channel = await db.scalar(
        select(MarketingChannel).where(
            MarketingChannel.id == channel_id,
            MarketingChannel.organization_id == user.organization_id,
        )
    )
    if channel is None:
        raise NotFound("Marketing channel")

    now = datetime.now(UTC)
    year = channel.goal_year or now.year

    achieved_count = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.marketing_channel_id == channel_id,
            func.extract("year", Sponsorship.start_date) == year,
            Sponsorship.status != "cancelled",
        )
    )
    achieved_amount = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(Sponsorship, Payment.sponsorship_id == Sponsorship.id)
        .where(
            Sponsorship.marketing_channel_id == channel_id,
            Payment.status == "completed",
            func.extract("year", Payment.completed_at) == year,
        )
    )

    monthly_achieved_count = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.marketing_channel_id == channel_id,
            func.extract("year", Sponsorship.start_date) == now.year,
            func.extract("month", Sponsorship.start_date) == now.month,
            Sponsorship.status != "cancelled",
        )
    )
    monthly_achieved_amount = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(Sponsorship, Payment.sponsorship_id == Sponsorship.id)
        .where(
            Sponsorship.marketing_channel_id == channel_id,
            Payment.status == "completed",
            func.extract("year", Payment.completed_at) == now.year,
            func.extract("month", Payment.completed_at) == now.month,
        )
    )

    achieved_count = int(achieved_count or 0)
    achieved_amount = Decimal(achieved_amount or 0)

    goal_count = channel.annual_goal_count
    goal_amount = channel.annual_goal_amount

    return ChannelProgress(
        channel_id=channel.id,
        goal_year=year,
        annual_goal_count=goal_count,
        annual_goal_amount=goal_amount,
        goal_currency=channel.goal_currency,
        achieved_count=achieved_count,
        achieved_amount=achieved_amount,
        completion_percentage_count=_pct(achieved_count, goal_count),
        completion_percentage_amount=_pct(float(achieved_amount), float(goal_amount or 0)),
        monthly_goal_count=(goal_count / 12) if goal_count is not None else None,
        monthly_goal_amount=(goal_amount / 12) if goal_amount is not None else None,
        monthly_achieved_count=int(monthly_achieved_count or 0),
        monthly_achieved_amount=Decimal(monthly_achieved_amount or 0),
    )


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
    changes: dict[str, Any] = {}
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
