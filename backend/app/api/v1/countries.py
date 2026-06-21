"""Country registration-requirement reads.

One endpoint: the resolved requirement config for a country, gated to the same
roles that may register an orphan (POST /orphans). Reference/config data, so no
tenant scoping. The profiles live in :mod:`app.core.country_requirements` and the
merge/baseline logic in :mod:`app.schemas.country`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.deps import DbSession
from app.api.v1.orphans import ORPHAN_CREATOR_ROLES
from app.core.authz import require_roles
from app.core.exceptions import NotFound
from app.models.user import User
from app.schemas.country import CountryListItem, CountryRequirementsResponse
from app.services.country_requirements import load_requirements_row

router = APIRouter()


@router.get("", response_model=list[CountryListItem])
async def list_countries(
    db: DbSession,
    # Same gate as GET /{code}/requirements (mirror POST /orphans): this list is
    # the first field of that intake form, so it is authenticated, never public.
    user: Annotated[User, Depends(require_roles(*ORPHAN_CREATOR_ROLES))],
) -> list[CountryListItem]:
    """Active countries for the registration country dropdown, by English name.

    Inactive countries are omitted so the form never offers one the platform does
    not register in. ``code`` is the ISO alpha-2; no pagination (small set).
    """
    rows = (
        (
            await db.execute(
                # lower(name_en): case-insensitive alphabetical order. The DB is
                # initialised with the C collation (docker-compose / CI initdb),
                # under which a bare ORDER BY name_en is byte-ordered — all-caps
                # codes (UAE/UK/USA) would sort before a mixed-case name like
                # Uganda — so lower() first to get the locale-agnostic order the
                # dropdown (and test_lists_active_countries) expects.
                text(
                    "SELECT code_alpha2 AS code, name_ar, name_en "
                    "FROM countries WHERE is_active = true ORDER BY lower(name_en)"
                )
            )
        )
        .mappings()
        .all()
    )
    return [
        CountryListItem(code=row["code"], name_ar=row["name_ar"], name_en=row["name_en"])
        for row in rows
    ]


@router.get("/{code}/requirements", response_model=CountryRequirementsResponse)
async def get_country_requirements(
    code: str,
    db: DbSession,
    # Gate to the same roles that may create an orphan (mirror POST /orphans):
    # this config drives that intake form, so it is authenticated, never public.
    user: Annotated[User, Depends(require_roles(*ORPHAN_CREATOR_ROLES))],
) -> CountryRequirementsResponse:
    """Resolved registration requirements for ``code`` (ISO alpha-2).

    404 only when ``code`` is not a country in ``countries``; a valid country
    with no ``country_requirements`` row resolves to the permissive baseline
    (``profile="baseline"``), never a 404.
    """
    norm = code.upper()
    # A non-existent country is the only 404 — an unconfigured one falls through
    # to the baseline below.
    country = await db.scalar(
        text("SELECT 1 FROM countries WHERE code_alpha2 = :code"), {"code": norm}
    )
    if country is None:
        raise NotFound("Country")

    # Shared with the conditional national_id validation in create_orphan_record:
    # a country with no row resolves to the permissive baseline, never a 404.
    row = await load_requirements_row(db, norm)
    return CountryRequirementsResponse.resolve(norm, row)
