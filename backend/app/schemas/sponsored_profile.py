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

from pydantic import BaseModel

# ── Per-element typed blocks ───────────────────────────────────────────────


class DreamBlock(BaseModel):
    """``dream`` — the child's aspiration, in their own words."""

    aspiration: str


class HerWorldBlock(BaseModel):
    """``her_world`` — a snapshot of where the child is right now."""

    education_stage: str | None = None
    tags: list[str]
    quran_juz_memorized: int | None = None
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

    # One optional block per ProfileElement (None ⇒ hidden or no data).
    dream: DreamBlock | None = None
    her_world: HerWorldBlock | None = None
    quran_growth: QuranGrowthBlock | None = None
    multidim_growth: MultidimGrowthBlock | None = None
    milestones: MilestonesBlock | None = None
    recent_updates: RecentUpdatesBlock | None = None
    supervisor_word: SupervisorWordBlock | None = None
    since_you_began: SinceYouBeganBlock | None = None
