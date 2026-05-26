from datetime import datetime
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
