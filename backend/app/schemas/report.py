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

# Section-visibility keys. A section is shown to donors UNLESS its key is
# explicitly ``False`` in ``orphan_reports.section_visibility``; an empty map
# (the product default) therefore means "all sections visible".
SECTION_KEYS: tuple[str, ...] = ("education", "quran", "activities", "health", "psychological")


# ── Canonical, typed report-section models ─────────────────────────────────
# These mirror the JSONB columns on ``orphan_reports`` and are validated at the
# API boundary while the DB keeps storing plain JSONB. Enum/scale values are
# fixed English codes (the UI localizes them); free-text fields stay free-form.
# Every field is optional so a half-filled section still validates, and
# ``extra="ignore"`` keeps reads resilient to legacy / ad-hoc keys that may
# still be sitting in the database.
_SECTION_CONFIG = ConfigDict(extra="ignore")


class SubjectGrade(BaseModel):
    model_config = _SECTION_CONFIG

    name: str
    grade: str | None = None


class EducationProgress(BaseModel):
    model_config = _SECTION_CONFIG

    stage: str | None = None
    school_name: str | None = None
    overall_rating: Literal["excellent", "very_good", "good", "fair", "needs_support"] | None = None
    attendance_percent: int | None = Field(default=None, ge=0, le=100)
    subjects: list[SubjectGrade] | None = None
    note: str | None = None


class QuranProgress(BaseModel):
    model_config = _SECTION_CONFIG

    juz_memorized: int | None = Field(default=None, ge=0, le=30)
    current_juz: int | None = Field(default=None, ge=1, le=30)
    evaluation: Literal["mastered", "very_good", "good", "needs_review"] | None = None
    recent: str | None = None
    note: str | None = None


class ActivityItem(BaseModel):
    model_config = _SECTION_CONFIG

    title: str
    note: str | None = None


class ActivitiesSection(BaseModel):
    model_config = _SECTION_CONFIG

    items: list[ActivityItem] | None = None
    note: str | None = None


class HealthStatus(BaseModel):
    model_config = _SECTION_CONFIG

    general: Literal["good", "stable", "monitored", "needs_attention"] | None = None
    note: str | None = None


class PsychologicalStatus(BaseModel):
    model_config = _SECTION_CONFIG

    mood: Literal["good", "okay", "needs_attention"] | None = None
    social: Literal["excellent", "good", "improving", "needs_support"] | None = None
    note: str | None = None


class ReportCreate(BaseModel):
    orphan_id: UUID
    report_type: ReportType
    period_start: date
    period_end: date
    summary: str | None = None
    educational_progress: EducationProgress | None = None
    quran_progress: QuranProgress | None = None
    activities: ActivitiesSection | None = None
    health_status: HealthStatus | None = None
    psychological_status: PsychologicalStatus | None = None
    donor_message: str | None = None
    is_milestone: bool = False
    milestone_label: str | None = None
    section_visibility: dict[str, bool] | None = None


class ReportRead(BaseModel):
    """Lightweight meta-only view (no section content). Still used by the
    guardian / orphanage self-portals and the report workflow transitions."""

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


class ReportDetailRead(BaseModel):
    """Full INTERNAL / staff view — every :class:`ReportRead` field plus the
    typed section content, the section-visibility map, and the donor-facing
    extras. NEVER returned to donors (see :class:`ReportDonorRead`)."""

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
    # Parsed from the stored JSONB into the canonical typed models.
    educational_progress: EducationProgress | None
    quran_progress: QuranProgress | None
    activities: ActivitiesSection | None
    health_status: HealthStatus | None
    psychological_status: PsychologicalStatus | None
    section_visibility: dict[str, bool]
    donor_message: str | None
    is_milestone: bool
    milestone_label: str | None


class ReportDonorRead(BaseModel):
    """DONOR-SAFE projection. Carries only the sections a supervisor chose to
    show (hidden ones arrive as ``null``) and NEVER exposes
    ``section_visibility``. Built via :func:`app.api.v1.donor_portal` rather
    than straight from the ORM row so the visibility filter is always applied.
    """

    id: UUID
    orphan_id: UUID
    report_type: ReportType
    period_start: date
    period_end: date
    summary: str | None
    donor_message: str | None
    is_milestone: bool
    milestone_label: str | None
    status: ReportStatus
    submitted_at: datetime | None
    partner_approved_at: datetime | None
    org_approved_at: datetime | None
    published_at: datetime | None
    photos_count: int
    videos_count: int
    documents_count: int
    created_at: datetime
    updated_at: datetime
    # Only the visible sections survive the projection; the rest stay null.
    educational_progress: EducationProgress | None = None
    quran_progress: QuranProgress | None = None
    activities: ActivitiesSection | None = None
    health_status: HealthStatus | None = None
    psychological_status: PsychologicalStatus | None = None


class ReportTransition(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class ReportUpdate(BaseModel):
    """Partial update — every field optional. Only allowed while the
    report is still in `draft` (the workflow refuses edits after submit)."""

    summary: str | None = None
    educational_progress: EducationProgress | None = None
    quran_progress: QuranProgress | None = None
    activities: ActivitiesSection | None = None
    health_status: HealthStatus | None = None
    psychological_status: PsychologicalStatus | None = None
    donor_message: str | None = None
    is_milestone: bool = False
    milestone_label: str | None = None
    section_visibility: dict[str, bool] | None = None
