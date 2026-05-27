from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

TransferStatus = Literal["pending", "approved", "processing", "completed", "failed", "cancelled"]


class BankTransferCreate(BaseModel):
    partner_organization_id: UUID
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    period_start: date
    period_end: date
    bank_name: str | None = Field(default=None, max_length=255)
    bank_reference: str | None = Field(default=None, max_length=255)
    notes: str | None = None


class BankTransferRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    partner_organization_id: UUID
    amount: Decimal
    currency: str
    bank_name: str | None
    bank_reference: str | None
    period_start: date
    period_end: date
    status: TransferStatus
    approved_by: UUID | None
    approved_at: datetime | None
    executed_by: UUID | None
    executed_at: datetime | None
    confirmed_by_partner_at: datetime | None
    notes: str | None
    created_at: datetime
