"""Resolved country-registration requirements — the read API response.

The config a client receives is a country's ``profile`` flags merged with its
``country_requirements`` row; a valid country with no row resolves to the
permissive baseline. Machine keys only — labels are localized elsewhere.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.core.country_requirements import (
    BASELINE,
    BASELINE_PROFILE,
    PROFILES,
    CountryProfile,
    CountryRequirementsRow,
)


class CountryFieldFlags(BaseModel):
    """Which intake sections/fields a country's profile turns on."""

    show_conflict_fields: bool
    requires_gps: bool
    show_housing: bool
    show_wash_fields: bool

    @classmethod
    def from_profile(cls, profile: CountryProfile) -> CountryFieldFlags:
        return cls(
            show_conflict_fields=profile.show_conflict_fields,
            requires_gps=profile.requires_gps,
            show_housing=profile.show_housing,
            show_wash_fields=profile.show_wash_fields,
        )


class NationalIdRequirements(BaseModel):
    required: bool
    length: int | None
    regex: str | None


class PhoneRequirements(BaseModel):
    regex: str | None


class CountryRequirementsResponse(BaseModel):
    country_code: str
    profile: str
    fields: CountryFieldFlags
    national_id: NationalIdRequirements
    phone: PhoneRequirements
    required_documents: list[str]

    @classmethod
    def resolve(
        cls, country_code: str, row: CountryRequirementsRow | None
    ) -> CountryRequirementsResponse:
        """Merge a loaded row onto its profile; fall back to the baseline.

        With no row the country is valid but unconfigured, so it resolves to the
        permissive baseline (``profile="baseline"``). With a row, the four field
        flags come from the row's profile while the national-id / phone /
        document rules come from the row itself — the row's
        ``national_id_required`` overrides the profile default.
        """
        if row is None:
            return cls(
                country_code=country_code,
                profile=BASELINE_PROFILE,
                fields=CountryFieldFlags.from_profile(BASELINE),
                national_id=NationalIdRequirements(
                    required=BASELINE.national_id_required_default,
                    length=None,
                    regex=None,
                ),
                phone=PhoneRequirements(regex=None),
                required_documents=[],
            )
        profile = PROFILES[row.profile]
        return cls(
            country_code=country_code,
            profile=row.profile,
            fields=CountryFieldFlags.from_profile(profile),
            national_id=NationalIdRequirements(
                required=row.national_id_required,
                length=row.national_id_length,
                regex=row.national_id_regex,
            ),
            phone=PhoneRequirements(regex=row.phone_regex),
            required_documents=list(row.required_documents),
        )
