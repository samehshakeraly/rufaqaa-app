from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

PartnerStatus = Literal["active", "suspended", "archived"]


class PartnerBase(BaseModel):
    name_ar: str = Field(min_length=1, max_length=255)
    name_en: str | None = Field(default=None, max_length=255)
    country_code: str = Field(min_length=2, max_length=2)


class PartnerCreate(PartnerBase):
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=30)
    contact_person: str | None = Field(default=None, max_length=255)


class PartnerUpdate(BaseModel):
    name_ar: str | None = Field(default=None, min_length=1, max_length=255)
    name_en: str | None = Field(default=None, max_length=255)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    status: PartnerStatus | None = None


class PartnerRead(PartnerBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    status: PartnerStatus
    created_at: datetime
