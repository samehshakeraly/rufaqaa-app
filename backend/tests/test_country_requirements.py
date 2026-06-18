"""Unit tests for the country-requirements resolver (pure, no DB).

``CountryRequirementsResponse.resolve`` is the single source of truth for merging
a loaded ``country_requirements`` row onto its profile and for the permissive
baseline a valid-but-unconfigured country falls back to. These pin the flag
bundles per profile and the row-overrides-profile-default rule so the endpoint
and the seeded rows stay in step.
"""

from __future__ import annotations

from app.core.country_requirements import PROFILES, CountryRequirementsRow
from app.schemas.country import CountryRequirementsResponse

# The two seeded rows, expressed as the resolver sees them after loading.
_PS_ROW = CountryRequirementsRow(
    profile="conflict",
    national_id_required=False,
    national_id_length=9,
    national_id_regex=None,
    phone_regex="^(059|056)[0-9]{7}$",
    required_documents=[
        "photo_id",
        "national_id",
        "birth_certificate",
        "death_certificate",
        "custody_declaration",
    ],
)
_EG_ROW = CountryRequirementsRow(
    profile="documented",
    national_id_required=True,
    national_id_length=14,
    national_id_regex="^[0-9]{14}$",
    phone_regex="^(010|011|012|015)[0-9]{8}$",
    required_documents=[
        "photo_id",
        "national_id",
        "birth_certificate",
        "death_certificate",
        "custody_declaration",
        "inheritance_decree",
    ],
)


def test_three_profiles_exist_with_expected_flags() -> None:
    """The flag bundles are exactly the three documented profiles."""
    conflict = PROFILES["conflict"]
    assert (
        conflict.show_conflict_fields,
        conflict.requires_gps,
        conflict.show_housing,
        conflict.show_wash_fields,
        conflict.national_id_required_default,
    ) == (True, False, False, False, False)

    documented = PROFILES["documented"]
    assert (
        documented.show_conflict_fields,
        documented.requires_gps,
        documented.show_housing,
        documented.show_wash_fields,
        documented.national_id_required_default,
    ) == (False, False, True, False, True)

    humanitarian = PROFILES["humanitarian"]
    assert (
        humanitarian.show_conflict_fields,
        humanitarian.requires_gps,
        humanitarian.show_housing,
        humanitarian.show_wash_fields,
        humanitarian.national_id_required_default,
    ) == (False, True, True, True, False)


def test_resolve_baseline_for_no_row() -> None:
    """A valid country with no row → the permissive baseline, never an error."""
    resolved = CountryRequirementsResponse.resolve("SA", None)
    assert resolved.country_code == "SA"
    assert resolved.profile == "baseline"
    assert resolved.fields.model_dump() == {
        "show_conflict_fields": False,
        "requires_gps": False,
        "show_housing": False,
        "show_wash_fields": False,
    }
    assert resolved.national_id.model_dump() == {"required": False, "length": None, "regex": None}
    assert resolved.phone.regex is None
    assert resolved.required_documents == []


def test_resolve_ps_conflict() -> None:
    resolved = CountryRequirementsResponse.resolve("PS", _PS_ROW)
    assert resolved.profile == "conflict"
    assert resolved.fields.show_conflict_fields is True
    assert resolved.fields.requires_gps is False
    assert resolved.fields.show_housing is False
    assert resolved.fields.show_wash_fields is False
    assert resolved.national_id.required is False
    assert resolved.national_id.length == 9
    assert resolved.national_id.regex is None
    assert resolved.phone.regex == "^(059|056)[0-9]{7}$"
    assert "custody_declaration" in resolved.required_documents
    assert "inheritance_decree" not in resolved.required_documents


def test_resolve_eg_documented() -> None:
    resolved = CountryRequirementsResponse.resolve("EG", _EG_ROW)
    assert resolved.profile == "documented"
    assert resolved.fields.show_housing is True
    assert resolved.fields.show_conflict_fields is False
    assert resolved.fields.requires_gps is False
    assert resolved.fields.show_wash_fields is False
    assert resolved.national_id.required is True
    assert resolved.national_id.length == 14
    assert resolved.national_id.regex == "^[0-9]{14}$"
    assert resolved.phone.regex == "^(010|011|012|015)[0-9]{8}$"
    assert resolved.required_documents[-1] == "inheritance_decree"


def test_row_national_id_required_overrides_profile_default() -> None:
    """The row's national_id_required wins over the profile default — a
    documented country may switch it off without changing its profile."""
    row = CountryRequirementsRow(
        profile="documented",  # default national_id_required_default=True
        national_id_required=False,
        national_id_length=14,
        national_id_regex=None,
        phone_regex=None,
        required_documents=[],
    )
    resolved = CountryRequirementsResponse.resolve("EG", row)
    assert PROFILES["documented"].national_id_required_default is True
    assert resolved.national_id.required is False
