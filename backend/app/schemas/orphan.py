from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

Gender = Literal["M", "F"]
CaseStatus = Literal[
    "pending_review",
    "approved",
    "rejected",
    "available",
    "reserved",
    "sponsored",
    "graduated",
    "deceased",
    "archived",
]
EducationStage = Literal[
    "not_enrolled",
    "kindergarten",
    "primary",
    "preparatory",
    "secondary",
    "university",
    "vocational",
    "graduated",
]
HealthStatus = Literal["good", "chronic_condition", "disability", "under_treatment"]
HealthCoverage = Literal["none", "government", "private", "charity"]
MotherStatus = Literal["alive", "deceased", "unknown"]
PriorityLevel = Literal["normal", "high", "urgent"]
# Who the child currently lives with. Enum-coded like the profile fields above;
# validated here in Pydantic only (no DB CHECK — mirrors education_stage).
LivesWith = Literal["mother", "relative", "orphanage", "other"]

# Sort options for the staff orphan list (GET /orphans). ``balanced`` is
# intentionally excluded here — it lands in a later batch.
OrphanSort = Literal[
    "recently_available",
    "longest_waiting",
    "priority",
    "most_complete",
    "newest",
]


class OrphanBase(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    family_name: str = Field(min_length=1, max_length=100)
    full_name_en: str | None = Field(default=None, max_length=255)
    date_of_birth: date
    gender: Gender
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    father_name: str | None = Field(default=None, max_length=255)
    father_death_date: date | None = None

    # Richer registration intake (see migration 0021). Optional everywhere, so
    # both create paths and OrphanRead carry them; national_id stays write-only.
    mother_name: str | None = Field(default=None, max_length=255)
    lives_with: LivesWith | None = None

    # Optional profile enrichment (see migration 0008). All optional so neither
    # the staff create path nor the light guardian intake is forced to set them.
    education_stage: EducationStage | None = None
    academic_level: str | None = Field(default=None, max_length=50)
    school_name: str | None = Field(default=None, max_length=255)
    quran_juz_memorized: int | None = Field(default=None, ge=0, le=30)
    quran_note: str | None = None
    health_status: HealthStatus | None = None
    health_coverage: HealthCoverage | None = None
    chronic_conditions: str | None = None
    aspiration: str | None = None
    challenges: str | None = None
    tags: list[str] = Field(default_factory=list)

    # Orphan browsing foundation (see migration 0009). Optional at creation —
    # both fall back to the DB default ('unknown' / 'normal') when omitted.
    mother_status: MotherStatus = "unknown"
    priority_level: PriorityLevel = "normal"


class OrphanCreateFields(OrphanBase):
    """Core identity fields for *creating* an orphan, shared by the staff
    create path (``OrphanCreate``) and the guardian self-service path
    (``GuardianOrphanCreate``) so both validate identically.

    ``father_name`` is **required** here (domain rule: an orphan is defined by
    their father — "son/daughter of <father>" — and the father's death
    certificate is a core document; there is no unknown-father case). Keeping
    it non-null also means the canonical ``idx_orphans_no_duplicate`` unique
    index fully covers duplicates with no NULL-father gap. ``OrphanBase`` keeps
    it optional so ``OrphanRead`` can still serialise any legacy rows.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    father_name: str = Field(min_length=1, max_length=255)

    # Country-aware intake (see migration 0014). Shared by both create paths —
    # the staff ``POST /orphans`` and the guardian self-service create — so each
    # accepts the same two fields. ``national_id`` is NOT validated here: the
    # rule is country-conditional (it depends on ``nationality``) and is enforced
    # centrally in ``services.orphans.create_orphan_record`` so both callers
    # obey it. It is accepted as input but encrypted at rest into
    # ``orphans.national_id_encrypted`` (see app.core.crypto); it is write-only
    # and never returned in any read schema. ``country_specific`` is the free
    # per-country JSONB bag — its contents are deliberately not validated, only
    # persisted verbatim.
    national_id: str | None = Field(default=None, max_length=50)
    country_specific: dict[str, Any] = Field(default_factory=dict)


class OrphanCreate(OrphanCreateFields):
    partner_organization_id: UUID
    family_id: UUID | None = None
    # Current dar (orphanage) the child resides in. STAFF-ONLY: the guardian
    # self-service path never sets it. Coexists with family_id by design
    # (family = background, dar = current sponsor). Org-validated server-side.
    orphanage_id: UUID | None = None


class OrphanUpdate(BaseModel):
    """Partial update. Every field optional — only the supplied keys are
    written. Status changes go through dedicated endpoints (workflow)."""

    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    family_name: str | None = Field(default=None, min_length=1, max_length=100)
    full_name_en: str | None = Field(default=None, max_length=255)
    date_of_birth: date | None = None
    gender: Gender | None = None
    nationality: str | None = Field(default=None, min_length=2, max_length=2)
    father_name: str | None = Field(default=None, max_length=255)
    father_death_date: date | None = None
    mother_name: str | None = Field(default=None, max_length=255)
    lives_with: LivesWith | None = None

    education_stage: EducationStage | None = None
    academic_level: str | None = Field(default=None, max_length=50)
    school_name: str | None = Field(default=None, max_length=255)
    quran_juz_memorized: int | None = Field(default=None, ge=0, le=30)
    quran_note: str | None = None
    health_status: HealthStatus | None = None
    health_coverage: HealthCoverage | None = None
    chronic_conditions: str | None = None
    aspiration: str | None = None
    challenges: str | None = None
    tags: list[str] | None = None

    mother_status: MotherStatus | None = None
    priority_level: PriorityLevel | None = None

    # Dar (orphanage) assignment. None in the payload leaves it untouched;
    # an explicit null clears it (family home). Org-validated in the endpoint.
    orphanage_id: UUID | None = None


class OrphanRead(OrphanBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    organization_id: UUID
    partner_organization_id: UUID
    family_id: UUID | None
    orphanage_id: UUID | None
    case_status: CaseStatus
    assigned_to_channel_id: UUID | None = None
    assigned_at: datetime | None = None
    assignment_deadline: datetime | None = None
    is_sponsored: bool
    current_balance: Decimal
    available_since: datetime | None = None
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_hafiz(self) -> bool:
        """Derived (not stored): a child who has memorised the whole Qur'an."""
        return self.quran_juz_memorized == 30
