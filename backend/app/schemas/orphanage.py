from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

OrphanageStatus = Literal["active", "inactive", "archived"]


class OrphanageBase(BaseModel):
    name_ar: str = Field(min_length=1, max_length=255)
    name_en: str = Field(min_length=1, max_length=255)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    governorate: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    address_details: str | None = None
    status: OrphanageStatus = "active"
    notes: str | None = None


class OrphanageCreate(OrphanageBase):
    partner_organization_id: UUID | None = None


class OrphanageUpdate(BaseModel):
    name_ar: str | None = Field(default=None, min_length=1, max_length=255)
    name_en: str | None = Field(default=None, min_length=1, max_length=255)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    governorate: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    address_details: str | None = None
    status: OrphanageStatus | None = None
    notes: str | None = None


class OrphanageRead(OrphanageBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    partner_organization_id: UUID | None
    created_at: datetime
    updated_at: datetime
