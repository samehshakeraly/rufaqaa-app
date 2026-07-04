"""Needs contracts (R7) — the staff CRUD shapes and the donor card.

The two coded vocabularies (:data:`NeedStatus` / :data:`NeedCategory`) are the
single source of truth for what ``status`` and ``category`` may hold —
enforced at the Pydantic boundary (422 on an unknown value; no DB CHECK, the
``health_status`` pattern). Because both are coded, the frontend localizes
them and no free text rides along to a donor. Money mirrors ``payments``:
``target_amount`` is a positive Numeric(10,2) and ``currency`` a 3-letter code.

``raised_amount`` is SYSTEM-managed and READ-ONLY everywhere in R7: it is not
a member of Create/Update (both ``extra="forbid"``, so even supplying it is a
422) — only R8's payment webhook will ever move it. ``status`` starts ``open``
on create (not settable) and transitions ONLY via the controlled Update field.

:class:`NeedRead` is the STAFF view (ids, timestamps, and the staff-only
``internal_note``). :class:`NeedCard` is the DONOR slice — a STRICT allowlist
of title/description/category/target_amount/currency/raised_amount/status plus
the DERIVED ``progress`` (0–100). ``internal_note``, ids, timestamps and
``orphan_id`` must NEVER be added to it.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

NEED_TITLE_MAX_LEN = 120

# Coded need lifecycle — the frontend localizes the values.
NeedStatus = Literal["open", "met", "archived"]

# Coded need categories — extend deliberately (each value needs ar/en labels
# in the frontend i18n bundles).
NeedCategory = Literal[
    "rent",
    "medicine",
    "supplies",
    "clothing",
    "education",
    "food",
    "other",
]


def _trimmed_non_empty_title(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("title must not be empty")
    if len(trimmed) > NEED_TITLE_MAX_LEN:
        raise ValueError(f"title must be at most {NEED_TITLE_MAX_LEN} characters")
    return trimmed


class NeedCreate(BaseModel):
    """Staff POST body. ``raised_amount`` and ``status`` are NOT members —
    the system starts every need at 0 / ``open`` (``extra="forbid"`` makes
    supplying either a 422, never a silent ignore)."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=NEED_TITLE_MAX_LEN)
    description: str | None = None
    internal_note: str | None = None
    category: NeedCategory | None = None
    target_amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str) -> str:
        return _trimmed_non_empty_title(value)


class NeedUpdate(BaseModel):
    """Staff PATCH body — every field optional; only supplied fields are
    applied (``exclude_unset``). ``status`` is the ONLY controlled transition
    surface (open/met/archived). ``raised_amount`` is deliberately NOT a
    member — with ``extra="forbid"`` supplying it (or any unknown key) is 422,
    so no R7 endpoint can ever move it."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=NEED_TITLE_MAX_LEN)
    description: str | None = None
    internal_note: str | None = None
    category: NeedCategory | None = None
    target_amount: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    status: NeedStatus | None = None

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str | None) -> str | None:
        return None if value is None else _trimmed_non_empty_title(value)


class NeedRead(BaseModel):
    """STAFF view of one need row — carries the stable ids, the staff-only
    ``internal_note``, the system-managed ``raised_amount`` and the
    timestamps. Never serialised to a donor."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    orphan_id: UUID
    title: str
    description: str | None = None
    internal_note: str | None = None
    category: str | None = None
    target_amount: Decimal
    currency: str
    raised_amount: Decimal
    status: str
    created_at: datetime
    updated_at: datetime


class NeedCard(BaseModel):
    """DONOR-FACING slice of one need — a STRICT allowlist: the title, the
    donor-facing description, the coded category (the frontend localizes it),
    the money trail (target/currency/raised), the coded status and the DERIVED
    ``progress`` (0–100). ``internal_note`` is staff-only free text and — like
    ids, timestamps and ``orphan_id`` — must NEVER be added here."""

    title: str
    description: str | None = None
    category: str | None = None
    target_amount: Decimal
    currency: str
    raised_amount: Decimal
    status: str
    progress: int = Field(ge=0, le=100)
