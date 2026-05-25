from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class DonorBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    full_name_en: str | None = Field(default=None, max_length=255)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=30)
    whatsapp: str | None = Field(default=None, max_length=30)
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    country_of_residence: str | None = Field(default=None, min_length=2, max_length=2)
    preferred_currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_anonymous: bool = False
    is_zakat_donor: bool = False


class DonorCreate(DonorBase):
    pass


class DonorUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    full_name_en: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    whatsapp: str | None = Field(default=None, max_length=30)
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    country_of_residence: str | None = Field(default=None, min_length=2, max_length=2)
    preferred_currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_anonymous: bool | None = None
    is_zakat_donor: bool | None = None
    status: str | None = Field(default=None, max_length=20)


class DonorRead(DonorBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    status: str
    total_sponsorships: int
    active_sponsorships: int
    total_donated: Decimal
    created_at: datetime
    updated_at: datetime
