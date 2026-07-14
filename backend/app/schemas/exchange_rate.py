from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ExchangeRateCreate(BaseModel):
    """Record a new rate: ``1 base_currency = rate quote_currency``.

    Rates are append-only — each write lands a NEW ``effective_at`` row so
    the history stays intact; lookups pick the most recent row at or before
    the payment instant. ``rate`` bounds and ``base != quote`` are checked
    in the endpoint so violations return a clear 400 (not a bare 422).
    """

    base_currency: str = Field(min_length=3, max_length=3)
    quote_currency: str = Field(min_length=3, max_length=3)
    rate: Decimal = Field(max_digits=18, decimal_places=8)
    # Omitted -> the row takes effect now (DB default).
    effective_at: datetime | None = None


class ExchangeRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    base_currency: str
    quote_currency: str
    rate: Decimal
    effective_at: datetime
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime
