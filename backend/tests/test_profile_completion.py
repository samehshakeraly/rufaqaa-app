"""Unit tests for the profile-completion measure (pure function, no DB).

``compute_profile_completion`` is the single source of truth for the
equal-weighted measure over seven enrichment fields; the 0010 data migration
and the demo seed both lean on it. These tests pin the rounding boundaries and
the per-field "filled" rules so the SQL mirror and the Python stay in step.
"""

from __future__ import annotations

from app.models.orphan import Orphan
from app.services.orphans import compute_profile_completion

# The seven equal-weight enrichment fields, each with a representative value.
_ALL_FILLED = {
    "nationality": "PS",
    "education_stage": "primary",
    "school_name": "Al-Noor School",
    "quran_juz_memorized": 5,
    "health_status": "good",
    "aspiration": "To become a doctor",
    "tags": ["top_student"],
}


def _orphan(**fields: object) -> Orphan:
    """A detached Orphan carrying only the supplied enrichment fields."""
    return Orphan(**fields)


def test_empty_orphan_is_zero() -> None:
    assert compute_profile_completion(_orphan()) == 0


def test_all_seven_fields_is_hundred() -> None:
    assert compute_profile_completion(_orphan(**_ALL_FILLED)) == 100


def test_three_of_seven_rounds_to_43() -> None:
    o = _orphan(nationality="PS", education_stage="primary", school_name="Al-Noor")
    assert compute_profile_completion(o) == 43  # round(3 / 7 * 100) == round(42.857)


def test_five_of_seven_rounds_to_71() -> None:
    o = _orphan(
        nationality="PS",
        education_stage="primary",
        school_name="Al-Noor",
        health_status="good",
        aspiration="engineer",
    )
    assert compute_profile_completion(o) == 71  # round(5 / 7 * 100) == round(71.428)


def test_quran_zero_counts_as_known() -> None:
    # 0 juz' is a *known* value, not "missing", so it counts towards completion.
    assert compute_profile_completion(_orphan(quran_juz_memorized=0)) == 14  # 1 / 7


def test_blank_and_whitespace_strings_do_not_count() -> None:
    # Empty / whitespace-only strings are not "filled"; an empty tag list and a
    # NULL juz' don't count either → still zero.
    o = _orphan(nationality="  ", school_name="", aspiration="\t", tags=[])
    assert compute_profile_completion(o) == 0
