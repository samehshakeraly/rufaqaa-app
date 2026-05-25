from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Gender = Literal["M", "F"]
CaseStatus = Literal[
    "pending_review",
    "approved",
    "rejected",
    "available",
    "reserved",
    "sponsored",
    "graduated",
    "deceased",
    "archived",
]


class OrphanBase(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    family_name: str = Field(min_length=1, max_length=100)
    full_name_en: str | None = Field(default=None, max_length=255)
    date_of_birth: date
    gender: Gender
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    father_name: str | None = Field(default=None, max_length=255)
    father_death_date: date | None = None


class OrphanCreate(OrphanBase):
    partner_organization_id: UUID
    family_id: UUID | None = None


class OrphanRead(OrphanBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    partner_organization_id: UUID
    family_id: UUID | None
    case_status: CaseStatus
    is_sponsored: bool
    current_balance: Decimal
    created_at: datetime
    updated_at: datetime
