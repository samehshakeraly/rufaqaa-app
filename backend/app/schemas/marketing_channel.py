from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ChannelStatus = Literal["active", "suspended", "archived"]
ChannelType = Literal[
    "digital_marketing",
    "committee",
    "website",
    "branch",
    "social_media",
    "partnership",
    "other",
]


class MarketingChannelBase(BaseModel):
    name_ar: str = Field(min_length=1, max_length=255)
    name_en: str | None = Field(default=None, max_length=255)
    channel_type: ChannelType | None = None
    description: str | None = None


class MarketingChannelCreate(MarketingChannelBase):
    pass


class MarketingChannelUpdate(BaseModel):
    name_ar: str | None = Field(default=None, min_length=1, max_length=255)
    name_en: str | None = Field(default=None, max_length=255)
    channel_type: ChannelType | None = None
    description: str | None = None
    status: ChannelStatus | None = None


class MarketingChannelRead(MarketingChannelBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: ChannelStatus
    created_at: datetime


class ChannelProgress(BaseModel):
    """Goal-vs-achieved snapshot for a marketing channel's annual targets.

    `achieved_count` counts non-cancelled sponsorships acquired through the
    channel within `goal_year`; `achieved_amount` sums completed payments on
    those channel's sponsorships in the same year. Monthly figures track the
    current calendar month against the (annual / 12) target.
    """

    channel_id: UUID
    goal_year: int

    annual_goal_count: int | None = None
    annual_goal_amount: Decimal | None = None
    goal_currency: str | None = None

    achieved_count: int
    achieved_amount: Decimal

    completion_percentage_count: float
    completion_percentage_amount: float

    monthly_goal_count: float | None = None
    monthly_goal_amount: Decimal | None = None
    monthly_achieved_count: int
    monthly_achieved_amount: Decimal
