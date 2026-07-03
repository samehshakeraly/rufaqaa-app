"""Skills/talents contracts (R5) — the staff CRUD shapes and the donor card.

The two coded vocabularies (:data:`SkillCategory` / :data:`SkillLevel`) are the
single source of truth for what ``category`` and ``level`` may hold — enforced
at the Pydantic boundary (422 on an unknown value; no DB CHECK, the
``health_status`` pattern). Because both are coded, the frontend localizes
them and no free text rides along to a donor.

:class:`SkillRead` is the STAFF view (ids, timestamps, and the staff-only
``note``). :class:`SkillCard` is the DONOR slice — a STRICT allowlist of
``name`` + coded ``category``/``level``. ``note``, ids and timestamps must
NEVER be added to it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

SKILL_NAME_MAX_LEN = 60

# Coded skill categories — extend deliberately (each value needs ar/en labels
# in the frontend i18n bundles).
SkillCategory = Literal[
    "quran",
    "academic",
    "arts",
    "sports",
    "languages",
    "crafts",
    "social",
    "other",
]

# Coded proficiency levels.
SkillLevel = Literal["beginner", "intermediate", "advanced"]


def _trimmed_non_empty(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("name must not be empty")
    if len(trimmed) > SKILL_NAME_MAX_LEN:
        raise ValueError(f"name must be at most {SKILL_NAME_MAX_LEN} characters")
    return trimmed


class SkillCreate(BaseModel):
    """Staff POST body. ``name`` is required (trimmed, 1–60 chars); the coded
    qualifiers and the staff-only ``note`` are optional."""

    name: str = Field(min_length=1, max_length=SKILL_NAME_MAX_LEN)
    category: SkillCategory | None = None
    level: SkillLevel | None = None
    note: str | None = None

    @field_validator("name")
    @classmethod
    def _trim_name(cls, value: str) -> str:
        return _trimmed_non_empty(value)


class SkillUpdate(BaseModel):
    """Staff PATCH body — every field optional; only supplied fields are
    applied (``exclude_unset``). An unknown key is rejected with 422."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=SKILL_NAME_MAX_LEN)
    category: SkillCategory | None = None
    level: SkillLevel | None = None
    note: str | None = None

    @field_validator("name")
    @classmethod
    def _trim_name(cls, value: str | None) -> str | None:
        return None if value is None else _trimmed_non_empty(value)


class SkillRead(BaseModel):
    """STAFF view of one skill row — carries the stable ids, the staff-only
    ``note`` and the timestamps. Never serialised to a donor."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    orphan_id: UUID
    name: str
    category: str | None = None
    level: str | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class SkillCard(BaseModel):
    """DONOR-FACING slice of one skill — a STRICT allowlist: the name plus the
    coded category/level (the frontend localizes them). ``note`` is staff-only
    free text and — like ids and timestamps — must NEVER be added here."""

    name: str
    category: str | None = None
    level: str | None = None
