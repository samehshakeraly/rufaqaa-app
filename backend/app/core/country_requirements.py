"""Country-registration requirement profiles — backend config, not DB rows.

A country's registration rules are a small named ``profile`` (a bundle of
UI/validation flags) plus a per-country ``country_requirements`` row carrying the
concrete national-id / phone / document rules. The profiles here are the
canonical source for those flag bundles; the resolver in :mod:`app.schemas.country`
merges a loaded row onto its profile and falls back to the permissive
:data:`BASELINE` for any valid country that has no row yet.

Reference/config only — like ``countries`` / ``currencies`` this is global (no
tenant, no RLS). Kept as Python constants so adjusting a profile needs no
migration; the per-country rows are seeded by a data migration.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CountryProfile:
    """The flag bundle a registration ``profile`` contributes.

    ``national_id_required_default`` is the profile's default for whether a
    national id is mandatory; a country's row overrides it through its own
    ``national_id_required`` column (the row always wins at resolution).
    """

    show_conflict_fields: bool
    requires_gps: bool
    show_housing: bool
    show_wash_fields: bool
    national_id_required_default: bool


# Profile name returned for a valid country that has no country_requirements row.
BASELINE_PROFILE: str = "baseline"

# Permissive fallback: nothing shown, nothing required, no GPS.
BASELINE: CountryProfile = CountryProfile(
    show_conflict_fields=False,
    requires_gps=False,
    show_housing=False,
    show_wash_fields=False,
    national_id_required_default=False,
)

# The three known profiles. Keys match the country_requirements.profile CHECK
# ('conflict' | 'documented' | 'humanitarian') added in migration 0014.
PROFILES: dict[str, CountryProfile] = {
    "conflict": CountryProfile(
        show_conflict_fields=True,
        requires_gps=False,
        show_housing=False,
        show_wash_fields=False,
        national_id_required_default=False,
    ),
    "documented": CountryProfile(
        show_conflict_fields=False,
        requires_gps=False,
        show_housing=True,
        show_wash_fields=False,
        national_id_required_default=True,
    ),
    "humanitarian": CountryProfile(
        show_conflict_fields=False,
        requires_gps=True,
        show_housing=True,
        show_wash_fields=True,
        national_id_required_default=False,
    ),
}


@dataclass(frozen=True)
class CountryRequirementsRow:
    """A loaded ``country_requirements`` row — the columns the resolver needs."""

    profile: str
    national_id_required: bool
    national_id_length: int | None
    national_id_regex: str | None
    phone_regex: str | None
    required_documents: list[str]
