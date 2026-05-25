from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PaymentMethod = Literal[
    "credit_card",
    "debit_card",
    "bank_transfer",
    "knet",
    "paypal",
    "cash",
    "cheque",
    "standing_order",
    "mobile_payment",
    "other",
]

PaymentStatus = Literal[
    "pending",
    "processing",
    "completed",
    "failed",
    "refunded",
    "partially_refunded",
    "chargeback",
    "disputed",
    "on_hold",
]


class PaymentCreate(BaseModel):
    donor_id: UUID
    sponsorship_id: UUID | None = None
    orphan_id: UUID | None = None
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    payment_method: PaymentMethod
    payment_gateway: str | None = None
    gateway_transaction_id: str | None = None
    notes: str | None = None


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    donor_id: UUID
    sponsorship_id: UUID | None
    orphan_id: UUID | None
    amount: Decimal
    currency: str
    payment_method: PaymentMethod
    payment_gateway: str | None
    gateway_transaction_id: str | None
    status: PaymentStatus
    initiated_at: datetime
    completed_at: datetime | None
    created_at: datetime
