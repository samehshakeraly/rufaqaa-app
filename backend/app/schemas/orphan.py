from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

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
# Coded education stages accepted on the create/update paths. Deliberately
# narrowed to these five — not_enrolled/university/vocational/graduated were
# dropped from intake. ``OrphanRead`` keeps ``education_stage`` permissive
# (plain ``str``) so legacy rows carrying a now-removed value still serialise
# without a 422.
EducationStage = Literal[
    "pre_kindergarten",
    "kindergarten",
    "primary",
    "preparatory",
    "secondary",
]
# Academic performance band, coded on create/update (replaces the old free
# text). ``OrphanRead`` keeps ``academic_level`` permissive (plain ``str``) so
# legacy free-text rows still serialise.
AcademicLevel = Literal["weak", "good", "excellent"]
HealthStatus = Literal["good", "chronic_condition", "disability", "under_treatment"]
HealthCoverage = Literal["none", "government", "private", "charity"]
# Coded vaccinations status (see migration 0028). Validated here in Pydantic
# only (no DB CHECK — mirrors health_status).
VaccinationsStatus = Literal["up_to_date", "partial", "unknown"]
# Coded readiness-for-independence stage (see migration 0030), ORDERED:
# طفولة → مهارات → تدريب مهني → تمكين → استقلال. This ordered tuple is the
# single source of truth for the vocabulary — the frontend derives the donor
# "next step" from this order, so it must never be reordered. Validated here
# in Pydantic only (no DB CHECK — mirrors mother_status/health_status).
IndependenceStage = Literal[
    "childhood",
    "skill_building",
    "vocational_training",
    "empowerment",
    "independence",
]
MotherStatus = Literal["alive", "deceased", "unknown"]
PriorityLevel = Literal["normal", "high", "urgent"]
# Who the child currently lives with. Enum-coded like the profile fields above;
# validated here in Pydantic only (no DB CHECK — mirrors education_stage).
LivesWith = Literal["mother", "relative", "orphanage", "other"]
# Donor-facing orphanhood status, DERIVED — never stored (migration 0016
# dropped ``parental_status`` deliberately). In this domain the father is
# always deceased, so the only split is whether the mother is too.
OrphanStatus = Literal["father", "both"]


def derive_orphan_status(mother_status: str) -> OrphanStatus:
    """Derive the donor-facing orphanhood status from ``mother_status``.

    The father is always deceased (an orphan is defined by their father —
    ``father_name`` + death certificate are core intake), so a deceased mother
    means orphaned of both parents; anything else (alive/unknown) is a
    paternal orphan."""
    return "both" if mother_status == "deceased" else "father"


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
    # Permissive on the base (and therefore on ``OrphanRead``): the create/
    # update paths narrow ``education_stage`` and ``academic_level`` to their
    # coded sets, but a row written before that narrowing may still hold a
    # now-removed stage ('university') or free-text level. Keeping the base
    # ``str`` lets those legacy rows serialise without a 422.
    education_stage: str | None = Field(default=None, max_length=30)
    academic_level: str | None = Field(default=None, max_length=50)
    school_name: str | None = Field(default=None, max_length=255)
    quran_juz_memorized: int | None = Field(default=None, ge=0, le=30)
    quran_note: str | None = None
    health_status: HealthStatus | None = None
    health_coverage: HealthCoverage | None = None
    chronic_conditions: str | None = None
    # Static health fields (see migration 0028). Both optional everywhere;
    # only the coded pair (health_status + these two) may reach the gated
    # donor ``health`` block — coverage/chronic text above stay staff-only.
    last_checkup: date | None = None
    vaccinations_status: VaccinationsStatus | None = None
    # Readiness-for-independence stage (see migration 0030). Coded by the
    # ordered vocabulary above; optional everywhere (brand-new column — no
    # legacy rows to keep permissive).
    independence_stage: IndependenceStage | None = None
    aspiration: str | None = None
    challenges: str | None = None
    tags: list[str] = Field(default_factory=list)

    # Small identity fields (see migration 0027). ``languages`` mirrors the
    # ``tags`` list pattern; ``current_juz`` is the juz' currently being
    # memorised — bounded 1–30 here in Pydantic only (no DB CHECK).
    languages: list[str] = Field(default_factory=list)
    current_juz: int | None = Field(default=None, ge=1, le=30)

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

    # Coded on the create paths (both staff and guardian-self): narrow the
    # permissive ``OrphanBase`` strings to their fixed vocabularies. Out-of-set
    # values are rejected with a 422. ``OrphanRead`` keeps the wider ``str``.
    education_stage: EducationStage | None = None
    academic_level: AcademicLevel | None = None

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

    @field_validator("national_id")
    @classmethod
    def _national_id_latin_only(cls, v: str | None) -> str | None:
        """Reject non-Latin characters in ``national_id`` — most importantly
        Arabic-Indic digits (٠-٩), which look numeric but break the encrypted
        store, the blind index, and every per-country regex.

        Runs *after* ``str_strip_whitespace`` has trimmed the value (model
        config), so the per-country length/regex checks downstream (in
        ``services.orphans._validate_national_id``) only ever see Latin input.
        An empty/None value is "absent" and left untouched.
        """
        if v and not v.isascii():
            raise ValueError(
                "national_id must use Latin (ASCII) characters; "
                "Arabic-Indic digits (٠-٩) are not allowed"
            )
        return v


class OrphanHomeAddress(BaseModel):
    """Optional family-residence address captured on the STAFF orphan-create
    path when the child lives with family (``lives_with`` ∈ {mother, relative}).

    Every field is optional and whitespace-trimmed (model config). When at least
    one address field is non-empty — OR a GPS ``latitude``/``longitude`` pair is
    supplied — AND the create payload pins no ``family_id``, the staff create
    service materialises a :class:`~app.models.family.Family` from this block in
    the same transaction and links the orphan to it (see
    ``services.orphans.create_orphan_record``). An all-empty block creates no
    family; a supplied ``family_id`` makes this block a no-op. The address
    columns already exist on ``families`` (migration 0021) and the GPS pair lands
    in the existing ``families.coordinates`` POINT — no new migration.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    city: str | None = Field(default=None, max_length=100)
    village: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    street: str | None = Field(default=None, max_length=255)
    house_number: str | None = Field(default=None, max_length=20)
    floor: str | None = Field(default=None, max_length=20)

    # Optional GPS capture (PR E) — persisted into the family's EXISTING
    # ``families.coordinates`` POINT (PostGIS write in the service), not a new
    # column. Both-or-neither: a lone latitude or longitude is rejected (422), so
    # a half-filled pair can never reach the DB. Ranges match valid WGS84 bounds.
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _coordinates_both_or_neither(self) -> Self:
        """Reject exactly one of latitude/longitude — a point needs both axes.
        ``0.0`` is a real coordinate (equator / prime meridian), so the check is
        on ``is None``, never truthiness."""
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self

    def has_content(self) -> bool:
        """True when at least one address field carries a non-empty (post-trim)
        value, or a full GPS pair is present — so a GPS-only block (no address)
        still triggers family creation. ``0.0`` counts (``is not None``)."""
        return any(
            (self.city, self.village, self.district, self.street, self.house_number, self.floor)
        ) or (self.latitude is not None and self.longitude is not None)


class OrphanCreate(OrphanCreateFields):
    partner_organization_id: UUID
    family_id: UUID | None = None
    # Current dar (orphanage) the child resides in. STAFF-ONLY: the guardian
    # self-service path never sets it. Coexists with family_id by design
    # (family = background, dar = current sponsor). Org-validated server-side.
    orphanage_id: UUID | None = None
    # Optional family-residence address — STAFF-ONLY (the guardian self-service
    # schema GuardianOrphanCreate has no such field). When it carries ≥1
    # non-empty field and no family_id is pinned, the create service builds a
    # Family from it and links the orphan (see services.orphans). Ignored when
    # family_id is already set; absent entirely creates no family.
    home_address: OrphanHomeAddress | None = None


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
    academic_level: AcademicLevel | None = None
    school_name: str | None = Field(default=None, max_length=255)
    quran_juz_memorized: int | None = Field(default=None, ge=0, le=30)
    quran_note: str | None = None
    health_status: HealthStatus | None = None
    health_coverage: HealthCoverage | None = None
    chronic_conditions: str | None = None
    last_checkup: date | None = None
    vaccinations_status: VaccinationsStatus | None = None
    independence_stage: IndependenceStage | None = None
    aspiration: str | None = None
    challenges: str | None = None
    tags: list[str] | None = None

    languages: list[str] | None = None
    current_juz: int | None = Field(default=None, ge=1, le=30)

    mother_status: MotherStatus | None = None
    priority_level: PriorityLevel | None = None

    # Dar (orphanage) assignment. None in the payload leaves it untouched;
    # an explicit null clears it (family home). Org-validated in the endpoint.
    orphanage_id: UUID | None = None


class OrphanNameMatch(BaseModel):
    """One soft-duplicate hit for the advisory name-matches lookup
    (``GET /orphans/name-matches``).

    The staff create form calls that endpoint before registering an orphan that
    carries no ``national_id`` and, if it returns any rows, warns that a child
    with this name already exists so the user can confirm it is not a duplicate.
    This shape carries ONLY the non-sensitive identity fields needed to eyeball
    that — the ``code`` (so the existing record can be opened), the name parts
    and the date of birth. It deliberately NEVER exposes ``national_id`` (or its
    blind index): the advisory is name-only, and the id stays write-only as
    everywhere else. ``father_name`` is nullable to match legacy rows (the model
    column allows NULL even though the create schema requires it).
    """

    model_config = ConfigDict(from_attributes=True)

    code: str
    first_name: str
    father_name: str | None
    family_name: str
    date_of_birth: date


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
