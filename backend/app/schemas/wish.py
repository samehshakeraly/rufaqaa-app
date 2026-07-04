"""Wishes contracts (R7) — the staff CRUD shapes and the donor card.

The coded :data:`WishStatus` vocabulary is the single source of truth for what
``status`` may hold — enforced at the Pydantic boundary (422 on an unknown
value; no DB CHECK, the ``health_status`` pattern). Money mirrors ``payments``:
``target_amount`` is a positive Numeric(10,2) and ``currency`` a 3-letter code.

``raised_amount`` is SYSTEM-managed and READ-ONLY everywhere in R7: it is not
a member of Create/Update (both ``extra="forbid"``, so even supplying it is a
422) — only R8's payment webhook will ever move it. ``status`` starts ``open``
on create (not settable) and transitions ONLY via the controlled Update field.

:class:`WishRead` is the STAFF view (ids, timestamps, and the staff-only
``internal_note``). :class:`WishCard` is the DONOR slice — a STRICT allowlist
of title/description/target_amount/currency/raised_amount/status plus the
DERIVED ``progress`` (0–100). ``internal_note``, ids, timestamps and
``orphan_id`` must NEVER be added to it.
"""

from __future__ import annotations

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

WISH_TITLE_MAX_LEN = 120

# Coded wish lifecycle — the frontend localizes the values.
WishStatus = Literal["open", "fulfilled", "archived"]


def _trimmed_non_empty_title(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("title must not be empty")
    if len(trimmed) > WISH_TITLE_MAX_LEN:
        raise ValueError(f"title must be at most {WISH_TITLE_MAX_LEN} characters")
    return trimmed


def progress_percent(raised: Decimal, target: Decimal) -> int:
    """DERIVED donor progress: raised/target as a whole percentage, clamped to
    0–100 (an over-funded wish/need still reads 100). ``target_amount`` is
    always > 0 (enforced on create), but guard against 0 defensively."""
    if target <= 0:
        return 0
    percent = (raised / target * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return max(0, min(100, int(percent)))


class WishCreate(BaseModel):
    """Staff POST body. ``raised_amount`` and ``status`` are NOT members —
    the system starts every wish at 0 / ``open`` (``extra="forbid"`` makes
    supplying either a 422, never a silent ignore)."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=WISH_TITLE_MAX_LEN)
    description: str | None = None
    internal_note: str | None = None
    target_amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3)

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str) -> str:
        return _trimmed_non_empty_title(value)


class WishUpdate(BaseModel):
    """Staff PATCH body — every field optional; only supplied fields are
    applied (``exclude_unset``). ``status`` is the ONLY controlled transition
    surface (open/fulfilled/archived). ``raised_amount`` is deliberately NOT a
    member — with ``extra="forbid"`` supplying it (or any unknown key) is 422,
    so no R7 endpoint can ever move it."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=WISH_TITLE_MAX_LEN)
    description: str | None = None
    internal_note: str | None = None
    target_amount: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    status: WishStatus | None = None

    @field_validator("title")
    @classmethod
    def _trim_title(cls, value: str | None) -> str | None:
        return None if value is None else _trimmed_non_empty_title(value)


class WishRead(BaseModel):
    """STAFF view of one wish row — carries the stable ids, the staff-only
    ``internal_note``, the system-managed ``raised_amount`` and the
    timestamps. Never serialised to a donor."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    orphan_id: UUID
    title: str
    description: str | None = None
    internal_note: str | None = None
    target_amount: Decimal
    currency: str
    raised_amount: Decimal
    status: str
    created_at: datetime
    updated_at: datetime


class WishCard(BaseModel):
    """DONOR-FACING slice of one wish — a STRICT allowlist: the title, the
    donor-facing description, the money trail (target/currency/raised), the
    coded status (the frontend localizes it) and the DERIVED ``progress``
    (0–100). ``internal_note`` is staff-only free text and — like ids,
    timestamps and ``orphan_id`` — must NEVER be added here."""

    title: str
    description: str | None = None
    target_amount: Decimal
    currency: str
    raised_amount: Decimal
    status: str
    progress: int = Field(ge=0, le=100)
