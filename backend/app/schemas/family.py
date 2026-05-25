from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

HousingStatus = Literal["owned", "rented", "donated", "homeless"]
Gender = Literal["M", "F"]
Relation = Literal[
    "mother",
    "father",
    "grandfather",
    "grandmother",
    "uncle",
    "aunt",
    "sibling",
    "other",
]
LiteracyLevel = Literal["illiterate", "low", "medium", "high"]


class FamilyBase(BaseModel):
    family_name: str | None = Field(default=None, max_length=255)
    deceased_father_name: str | None = Field(default=None, max_length=255)
    father_death_date: date | None = None
    father_death_cause: str | None = Field(default=None, max_length=255)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    governorate: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    address_details: str | None = None
    monthly_income: Decimal | None = Field(default=None, max_digits=10, decimal_places=2)
    income_currency: str | None = Field(default=None, min_length=3, max_length=3)
    housing_status: HousingStatus | None = None
    notes: str | None = None


class FamilyCreate(FamilyBase):
    partner_organization_id: UUID | None = None


class FamilyRead(FamilyBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    partner_organization_id: UUID | None
    created_at: datetime
    updated_at: datetime


class GuardianBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    national_id: str | None = Field(default=None, max_length=50)
    date_of_birth: date | None = None
    gender: Gender | None = None
    relation: Relation
    phone: str | None = Field(default=None, max_length=30)
    whatsapp: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    literacy_level: LiteracyLevel = "low"
    preferred_communication: str = Field(default="whatsapp", max_length=20)


class GuardianCreate(GuardianBase):
    family_id: UUID | None = None


class GuardianRead(GuardianBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    family_id: UUID | None
    status: str
    created_at: datetime
    updated_at: datetime
