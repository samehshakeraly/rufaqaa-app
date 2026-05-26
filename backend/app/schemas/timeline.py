from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

TimelineKind = Literal["sponsorship", "payment", "report", "media"]


class TimelineEvent(BaseModel):
    """One row in the orphan timeline. `kind` tells the frontend how to
    interpret the entity_id; `summary` is a small human-readable hint."""

    when: datetime
    kind: TimelineKind
    entity_id: UUID
    summary: str
    amount: Decimal | None = None
    currency: str | None = None
    status: str | None = None


class Timeline(BaseModel):
    items: list[TimelineEvent]
