from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ReportType = Literal["monthly", "quarterly", "annual", "special", "incident"]
ReportStatus = Literal[
    "draft",
    "pending_partner_approval",
    "partner_approved",
    "pending_org_approval",
    "org_approved",
    "published_to_donor",
    "rejected",
]


class ReportCreate(BaseModel):
    orphan_id: UUID
    report_type: ReportType
    period_start: date
    period_end: date
    summary: str | None = None
    educational_progress: dict | None = None
    quran_progress: dict | None = None
    activities: dict | None = None
    health_status: dict | None = None
    psychological_status: dict | None = None


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    organization_id: UUID
    orphan_id: UUID
    report_type: ReportType
    period_start: date
    period_end: date
    summary: str | None
    status: ReportStatus
    submitted_at: datetime | None
    partner_approved_at: datetime | None
    org_approved_at: datetime | None
    published_at: datetime | None
    rejection_reason: str | None
    photos_count: int
    videos_count: int
    documents_count: int
    created_at: datetime
    updated_at: datetime


class ReportTransition(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)
