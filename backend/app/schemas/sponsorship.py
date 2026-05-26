from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SponsorshipStatus = Literal[
    "pending",
    "active",
    "paused",
    "overdue",
    "cancelled",
    "completed",
    "transferred",
]

PaymentFrequency = Literal["monthly", "quarterly", "semi_annual", "annual", "one_time"]


class SponsorshipBase(BaseModel):
    donor_id: UUID
    orphan_id: UUID
    monthly_amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    start_date: date
    end_date: date | None = None
    payment_frequency: PaymentFrequency = "monthly"
    payment_method: str | None = Field(default=None, max_length=30)
    notes: str | None = None


class SponsorshipCreate(SponsorshipBase):
    pass


class SponsorshipRead(SponsorshipBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    status: SponsorshipStatus
    total_paid: Decimal
    payments_count: int
    next_payment_date: date | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    # Lightweight denormalised hints. Populated by list/get endpoints
    # via a batch join — purely for display, so the frontend doesn't
    # need a separate request per row.
    donor_code: str | None = None
    donor_name: str | None = None
    orphan_code: str | None = None
    orphan_name: str | None = None


class SponsorshipCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class SponsorshipUpdate(BaseModel):
    """Partial update. Status changes go through dedicated /pause and
    /resume endpoints — leaving the cancel/complete transitions on
    their own routes so each one can keep its specific guard logic.
    """

    monthly_amount: Decimal | None = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    payment_frequency: PaymentFrequency | None = None
    payment_method: str | None = Field(default=None, max_length=30)
    notes: str | None = None
    end_date: date | None = None
