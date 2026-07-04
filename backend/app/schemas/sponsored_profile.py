"""Donor-safe composition of a sponsored child's humanizing profile.

This is the response of ``GET /me/sponsorships/{orphan_id}/profile``. It is
assembled entirely from already-donor-safe data:

* the identity/header block reuses the EXACT safe slice of
  :class:`app.api.v1.public.PublicOrphanDetail` (via ``to_public_detail``) — it
  is implicit and ALWAYS present, and can never be hidden;
* one optional, typed block per :class:`ProfileElement`. A block is non-null
  ONLY IF the element is visible per ``orphans.profile_visibility`` AND its
  underlying data exists; otherwise it is ``None`` (omitted) — mirroring the
  report ``_visible_section`` projection.

The report-derived blocks are built from the SAME donor-scoped, donor-safe
reports that back ``/me/reports`` (each report's own section visibility is
respected), so no sensitive field can leak. ``profile_visibility`` itself is
consumed server-side and NEVER appears in this response.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.schemas.need import NeedCard
from app.schemas.orphan import (
    HealthStatus,
    IndependenceStage,
    OrphanStatus,
    VaccinationsStatus,
)
from app.schemas.skill import SkillCard
from app.schemas.wish import WishCard

# Curated phrase limits — shared by the staff input contract and the donor
# composition; kept here so backend and the generated TS types agree.
IN_HER_WORDS_MAX_LEN = 280
IN_HER_WORDS_MAX_ITEMS = 20

# ── Per-element typed blocks ───────────────────────────────────────────────


class DreamBlock(BaseModel):
    """``dream`` — the child's aspiration, in their own words."""

    aspiration: str


class HerWorldBlock(BaseModel):
    """``her_world`` — a snapshot of where the child is right now."""

    education_stage: str | None = None
    tags: list[str]
    quran_juz_memorized: int | None = None
    # The juz' currently being memorised (R1) — gated by the her_world
    # element exactly like the sibling fields above.
    current_juz: int | None = None
    is_hafiz: bool


class QuranGrowthPoint(BaseModel):
    period: date
    juz_memorized: int


class QuranGrowthBlock(BaseModel):
    """``quran_growth`` — juz' memorised over time, oldest→newest."""

    series: list[QuranGrowthPoint]


class TextDelta(BaseModel):
    first: str
    latest: str


class NumberDelta(BaseModel):
    first: int
    latest: int


class MultidimGrowthBlock(BaseModel):
    """``multidim_growth`` — first-vs-latest deltas across a few dimensions."""

    education_stage: TextDelta | None = None
    attendance_percent: NumberDelta | None = None
    social: TextDelta | None = None


class MilestoneItem(BaseModel):
    label: str
    period: date


class MilestonesBlock(BaseModel):
    """``milestones`` — the celebrated moments along the way."""

    items: list[MilestoneItem]


class RecentUpdateItem(BaseModel):
    period: date
    headline: str


class RecentUpdatesBlock(BaseModel):
    """``recent_updates`` — the latest few report headlines, newest first."""

    items: list[RecentUpdateItem]


class SupervisorWordBlock(BaseModel):
    """``supervisor_word`` — the latest warm note from the supervisor."""

    text: str
    period: date
    author_label: str | None = None


class SinceYouBeganBlock(BaseModel):
    """``since_you_began`` — what changed since this donor's sponsorship began."""

    start_date: date
    juz_gained: int
    milestones_count: int
    reports_count: int


class MediaItem(BaseModel):
    """One donor-cleared piece of media. EXPOSES ONLY this safe slice — never the
    storage key, consent document, moderation internals, uploader or org. ``url``
    (and ``thumbnail_url`` when present) are fresh, short-lived presigned GETs."""

    id: UUID
    title: str | None = None
    caption: str | None = None
    display_date: date
    url: str
    thumbnail_url: str | None = None
    duration_seconds: int | None = None
    width: int | None = None
    height: int | None = None


class MediaBlock(BaseModel):
    """``media`` — donor-cleared artefacts grouped by category. Present only when
    the element is visible AND at least one group has a qualifying item."""

    drawings: list[MediaItem]
    certificates: list[MediaItem]
    album: list[MediaItem]
    recitations: list[MediaItem]


class InHerWordsItem(BaseModel):
    """One curated phrase, in the child's own words. DONOR-FACING slice — exposes
    only the phrase ``text`` and an optional ``said_on`` date; never the internal
    id or any authoring metadata."""

    text: str
    said_on: date | None = None


class FatherMemory(BaseModel):
    """``father_memory`` — a dignified remembrance of the child's deceased father.

    DONOR-FACING slice — exposes ONLY the father's name and the YEAR of death.
    The death CERTIFICATE and the full death DATE never leave the server, and
    this block is emitted only when guardian consent is on record AND the
    supervisor left the element visible (the double gate)."""

    father_name: str
    death_year: int | None = None


class HealthBlock(BaseModel):
    """``health`` — a reassuring, non-clinical health summary. SENSITIVE: this
    is the FIRST health data on any donor surface, so the slice is deliberately
    minimal — ONLY the coded high-level status (the frontend localizes it), the
    date of the last checkup, and the coded vaccinations status.
    ``chronic_conditions``, ``health_coverage``, ``challenges`` and every free
    text stay staff-only and must NEVER be added here."""

    status_label: HealthStatus | None = None
    last_checkup: date | None = None
    vaccinations_status: VaccinationsStatus | None = None


class HomeBlock(BaseModel):
    """``home`` — a minimal, PII-free glimpse of the child's home. SENSITIVE:
    this is FAMILY data on a donor surface, so the slice is a strict allowlist —
    ONLY the governorate (region at GOVERNORATE level, never finer) and the
    coded housing status (the frontend localizes it). ``city`` / ``district`` /
    ``village`` / ``street`` / ``house_number`` / ``floor`` / ``address_details``
    / coordinates / ``notes`` / ``code`` / ``family_name`` / ``monthly_income``
    stay staff-only and must NEVER be added here."""

    governorate: str | None = None
    housing_status: str | None = None


class GuardianBlock(BaseModel):
    """``guardian`` — who cares for the child, without identifying them.
    SENSITIVE: this is GUARDIAN data on a donor surface, so the slice is a
    strict allowlist — ONLY the coded relation (the frontend localizes it) and
    the occupation. ``full_name`` / ``national_id`` / ``phone`` / ``whatsapp``
    / ``email`` / ``bank_account_info`` / ``literacy_level`` /
    ``date_of_birth`` / ``user_id`` / ``code`` stay staff-only and must NEVER
    be added here."""

    relation: str
    occupation: str | None = None


class SiblingCard(BaseModel):
    """One sibling of the sponsored child. SENSITIVE: these are OTHER children
    on a donor surface, so the slice is a strict allowlist — the first name,
    the age, the gender and the coded sponsorship standing (the frontend
    localizes it). ``code`` is populated ONLY for an awaiting_sponsor sibling
    (that child is already publicly listable, so the code links the public
    sponsorship page); for a sponsored sibling it MUST stay None so a donor
    can never dereference another donor's child. ``family_name`` /
    ``national_id`` / health / address / father details / case internals /
    sponsor identity stay staff-only and must NEVER be added here."""

    first_name: str
    age_years: int
    gender: Literal["M", "F"]
    sponsorship_status: Literal["sponsored", "awaiting_sponsor"]
    code: str | None = None


class SiblingsBlock(BaseModel):
    """``siblings`` — the child's brothers and sisters, oldest first."""

    items: list[SiblingCard]


class SkillsBlock(BaseModel):
    """``skills`` — the child's skills and talents, oldest first. Each item is
    the strict :class:`SkillCard` allowlist (name + coded category/level); the
    staff-only ``note`` never reaches this block."""

    items: list[SkillCard]


class WishesBlock(BaseModel):
    """``wishes`` — the child's donor-fundable wishes, oldest first (archived
    ones excluded server-side). Each item is the strict :class:`WishCard`
    allowlist (title/description/money trail/coded status + derived progress);
    the staff-only ``internal_note`` — and every id/timestamp — never reaches
    this block."""

    items: list[WishCard]


class NeedsBlock(BaseModel):
    """``needs`` — the child's donor-fundable material needs, oldest first
    (archived ones excluded server-side). Each item is the strict
    :class:`NeedCard` allowlist (title/description/coded category/money trail/
    coded status + derived progress); the staff-only ``internal_note`` — and
    every id/timestamp — never reaches this block."""

    items: list[NeedCard]


class IndependenceBlock(BaseModel):
    """``independence`` — the child's current readiness-for-independence stage.

    The slice is ONLY the coded ``stage`` — NOTHING else may ever be added: the
    "next step" label is DERIVED on the frontend from the ordered
    :data:`~app.schemas.orphan.IndependenceStage` vocabulary and the empowerment
    charter (ميثاق التمكين) is static, localized frontend text — neither is a
    data field."""

    stage: IndependenceStage


# ── The composed, donor-safe profile ───────────────────────────────────────


class SponsoredOrphanProfile(BaseModel):
    """The donor-safe profile of a sponsored child. Identity fields are always
    present; each element block is non-null only when visible AND backed by data.

    The identity slice is the EXACT donor-safe set already vetted on
    ``PublicOrphanDetail`` — never broadened here. ``profile_visibility`` is
    never serialised."""

    # Always-present identity/header block (implicit; cannot be hidden).
    first_name: str
    age_years: int
    gender: Literal["M", "F"]
    country: str | None = None
    partner_organization_name: str | None = None
    aspiration: str | None = None
    education_stage: str | None = None
    quran_juz_memorized: int | None = None
    tags: list[str]
    is_hafiz: bool
    # Small identity additions (R1) — same vetted slice as PublicOrphanDetail:
    # the child's languages and the DERIVED (never stored) orphanhood status.
    languages: list[str]
    orphan_status: OrphanStatus

    # One optional block per ProfileElement (None ⇒ hidden or no data).
    dream: DreamBlock | None = None
    her_world: HerWorldBlock | None = None
    quran_growth: QuranGrowthBlock | None = None
    multidim_growth: MultidimGrowthBlock | None = None
    milestones: MilestonesBlock | None = None
    recent_updates: RecentUpdatesBlock | None = None
    supervisor_word: SupervisorWordBlock | None = None
    since_you_began: SinceYouBeganBlock | None = None
    media: MediaBlock | None = None
    in_her_words: list[InHerWordsItem] | None = None
    father_memory: FatherMemory | None = None
    health: HealthBlock | None = None
    home: HomeBlock | None = None
    guardian: GuardianBlock | None = None
    siblings: SiblingsBlock | None = None
    skills: SkillsBlock | None = None
    independence: IndependenceBlock | None = None
    wishes: WishesBlock | None = None
    needs: NeedsBlock | None = None


# ── Staff management contract (full list, incl. ids) ───────────────────────


class FatherMemoryConsent(BaseModel):
    """Staff GET/PATCH contract for the father's-memory guardian consent — the
    first of the two gates that disclose the father's memory to donors. The
    visibility gate is the existing ``father_memory`` element on
    ``profile_visibility``; both must be on for the block to reach the donor."""

    consent: bool


class InHerWordsStaffItem(BaseModel):
    """One curated phrase as the management UI sees it — carries the stable
    ``id`` (so edits/reorders re-use it) alongside the editable fields."""

    id: UUID
    text: str
    said_on: date | None = None


class InHerWordsList(BaseModel):
    """Staff GET response: the full ordered list of phrases. The array order IS
    the donor display order — the PUT controls it."""

    items: list[InHerWordsStaffItem]


class InHerWordsItemUpdate(BaseModel):
    """One phrase as supplied by the management UI on PUT. ``id`` is re-used when
    present (an edit/reorder) and assigned server-side when absent (a new
    phrase). Per-item rules — trimmed non-empty ``text`` capped at
    :data:`IN_HER_WORDS_MAX_LEN`, ``said_on`` never in the future — are enforced
    here at the Pydantic boundary (violation ⇒ 422)."""

    id: UUID | None = None
    text: str
    said_on: date | None = None

    @field_validator("text")
    @classmethod
    def _trim_non_empty(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("text must not be empty")
        if len(trimmed) > IN_HER_WORDS_MAX_LEN:
            raise ValueError(f"text must be at most {IN_HER_WORDS_MAX_LEN} characters")
        return trimmed

    @field_validator("said_on")
    @classmethod
    def _not_future(cls, value: date | None) -> date | None:
        if value is not None and value > date.today():
            raise ValueError("said_on must not be in the future")
        return value
