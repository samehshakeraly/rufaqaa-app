"""Donor-profile element registry — the single source of truth for which
elements of the donor-facing child profile can be shown or hidden.

The visibility map (``orphans.profile_visibility``) mirrors the proven report
``section_visibility`` semantics exactly: an element is shown to donors UNLESS
its key is explicitly ``False``, so the default ``{}`` means "all elements
visible". The identity/header block is implicit and ALWAYS shown — it is NOT a
member of :class:`ProfileElement` and can never be hidden.

Adding a future element (``media``, ``father_memorial``, …) is a one-line change
here plus the matching block on the donor composition.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class ProfileElement(StrEnum):
    """Every toggleable element of the donor child profile, keyed exactly to the
    data that exists today. Extend by adding one member (and its block on
    :class:`app.schemas.sponsored_profile.SponsoredOrphanProfile`)."""

    dream = "dream"
    her_world = "her_world"
    quran_growth = "quran_growth"
    multidim_growth = "multidim_growth"
    milestones = "milestones"
    recent_updates = "recent_updates"
    supervisor_word = "supervisor_word"
    since_you_began = "since_you_began"
    media = "media"
    in_her_words = "in_her_words"
    father_memory = "father_memory"
    health = "health"


def is_visible(profile_visibility: dict[str, bool], key: ProfileElement) -> bool:
    """An element is visible UNLESS its key is explicitly ``False`` in the stored
    map. An absent key (the default) ⇒ visible. Mirrors the report
    ``_visible_section`` rule so the two surfaces behave identically."""
    return profile_visibility.get(key.value) is not False


class ProfileElementState(BaseModel):
    """One row of the staff registry: an element + its current effective state."""

    key: ProfileElement
    visible: bool


class ProfileVisibilityRegistry(BaseModel):
    """Staff GET response: the full registry (every :class:`ProfileElement` with
    its current effective state) plus the raw stored map for transparency."""

    elements: list[ProfileElementState]
    stored: dict[str, bool]


class ProfileVisibilityUpdate(BaseModel):
    """Staff PUT body. Typing the map as ``dict[ProfileElement, bool]`` makes
    Pydantic reject (422) any unknown key or non-bool value at the boundary —
    no hand-rolled validation needed."""

    visibility: dict[ProfileElement, bool]
