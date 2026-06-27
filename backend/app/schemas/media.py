"""Orphan-media library policy — the single, explicit source of truth for
media categories and which of them gate on guardian consent.

The donor-safe exposure (``app.api.v1.donor_portal``) and the staff upload/manage
endpoints (``app.api.v1.media``) both import from here so the consent rule is
declared exactly once.
"""

from __future__ import annotations

from enum import StrEnum


class MediaCategory(StrEnum):
    """Every donor-library category a piece of media can carry (migration 0024).

    ``portrait`` is the identity-photo default that legacy ``media_type='photo'``
    rows are backfilled to; the four donor-surfaced groups are drawing /
    certificate / album / recitation."""

    drawing = "drawing"
    certificate = "certificate"
    album = "album"
    recitation = "recitation"
    portrait = "portrait"


# Categories whose content is the child's own voice or likeness, so a piece of
# media may only ever reach a donor when guardian consent is on record. Drawings
# and certificates are artefacts (no consent gate) — but, like everything else,
# they still require approval + a donor-facing visibility to surface.
CONSENT_REQUIRED_CATEGORIES: frozenset[str] = frozenset(
    {
        MediaCategory.recitation.value,
        MediaCategory.album.value,
        MediaCategory.portrait.value,
    }
)
