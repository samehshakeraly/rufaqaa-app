from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

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

# Derived (not stored): "kafala" when the payment is tied to a sponsorship,
# otherwise a "general" donation. There is no payment-level type column — this
# is computed from ``sponsorship_id`` on the list endpoint and used as a filter.
PaymentType = Literal["kafala", "general"]

# Stored (``payments.target_type``, migration 0031): a general donation into a
# named pool rather than a child or a sponsorship. "waqf" is the orphans
# endowment (PR-W01). The column is a plain nullable String(20) — this Literal
# is the API-level allow-list, so a typo can never reach the row.
PaymentTarget = Literal["waqf", "zakat"]


class PaymentStatusUpdate(BaseModel):
    """Manual status transition by ops — e.g. marking a pending wire as
    completed or a chargebacked one as refunded. Does NOT replay the
    side effects (sponsorship totals), so use sparingly."""

    status: PaymentStatus
    reason: str | None = Field(default=None, max_length=1000)


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

    # List-payload enrichment (derived via joins on the list endpoint; default
    # None so model_validate() of a bare Payment row stays valid).
    #
    # Privacy / child-safety: ``orphan_code`` is the orphan's CODE only — never
    # a name. ``donor_reference`` is the donor's non-identifying CODE — never a
    # name or email. Both come from the related row's ``code`` column.
    orphan_code: str | None = None
    donor_reference: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def payment_type(self) -> PaymentType:
        """Derived (not stored): "kafala" when tied to a sponsorship, else
        a "general" donation. See ``GET /payments``."""
        return "kafala" if self.sponsorship_id is not None else "general"


class PaymentInitiate(BaseModel):
    """Start a hosted-checkout flow with MyFatoorah for either a
    one-off donation, an existing sponsorship, or a general pool
    (``target_type``)."""

    donor_id: UUID
    sponsorship_id: UUID | None = None
    orphan_id: UUID | None = None
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)
    language: Literal["ar", "en"] = "ar"
    target_type: PaymentTarget | None = None

    @model_validator(mode="after")
    def _pool_payments_carry_no_child(self) -> "PaymentInitiate":
        """A pool donation is by definition NOT tied to a child or a
        sponsorship — the money goes into the pool, not to a named
        beneficiary. Sending both is a caller bug, not a preference, so
        it is refused (422) instead of silently dropping one side."""
        if self.target_type is not None and (
            self.sponsorship_id is not None or self.orphan_id is not None
        ):
            raise ValueError("target_type cannot be combined with sponsorship_id or orphan_id")
        return self


class PaymentInitiateResponse(BaseModel):
    """Returned to the caller so the SPA can redirect the donor."""

    payment_id: UUID
    invoice_id: str
    payment_url: str


class PaymentRefund(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    reason: str = Field(min_length=1, max_length=500)


class PaymentDonorRead(BaseModel):
    """DONOR-SAFE projection of a payment. Carries only the fields a sponsor
    needs to see their own money trail. Fields that could leak internal ops,
    gateway details, or other donors' data are deliberately excluded."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    amount: Decimal
    currency: str
    amount_in_default_currency: Decimal | None
    payment_method: str
    status: str
    initiated_at: datetime
    completed_at: datetime | None
    receipt_number: str | None
    receipt_issued_at: datetime | None
    receipt_url: str | None
    sponsorship_id: UUID | None
    orphan_id: UUID | None
    # Which pool a general donation went into ("waqf"), or None for a
    # child/sponsorship payment. Not an enum here: the column is free-form
    # and older rows may carry values this build doesn't know about.
    target_type: str | None = None

    # References the donor takes to their bank when a payment goes wrong.
    # NOT internal ops data: the gateway hands both to the donor's own bank
    # statement anyway. ``payment_gateway`` and the rest stay excluded.
    gateway_transaction_id: str | None
    bank_reference: str | None

    # Child privacy: name + code only, enriched via a batch join on the list
    # endpoint (default None so model_validate() of a bare row stays valid).
    orphan_name: str | None = None
    orphan_code: str | None = None


class PaymentReceipt(BaseModel):
    """Self-contained snapshot of a payment for printing. Bundles the
    donor + orphan + organization fields the receipt page needs so the
    UI doesn't have to fan out to 4 endpoints."""

    payment_id: UUID
    payment_code: str
    amount: Decimal
    currency: str
    payment_method: PaymentMethod
    status: PaymentStatus
    completed_at: datetime | None
    initiated_at: datetime

    donor_id: UUID
    donor_code: str
    donor_name: str
    donor_email: str | None

    sponsorship_id: UUID | None
    sponsorship_code: str | None
    orphan_id: UUID | None
    orphan_code: str | None
    orphan_name: str | None

    organization_id: UUID
    organization_name_ar: str
    organization_name_en: str | None
