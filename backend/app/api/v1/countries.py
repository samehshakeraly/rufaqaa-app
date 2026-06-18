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
from app.core.country_requirements import CountryRequirementsRow
from app.core.exceptions import NotFound
from app.models.user import User
from app.schemas.country import CountryRequirementsResponse

router = APIRouter()


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

    record = (
        (
            await db.execute(
                text(
                    "SELECT profile, national_id_required, national_id_length, "
                    "national_id_regex, phone_regex, required_documents "
                    "FROM country_requirements WHERE country_code = :code"
                ),
                {"code": norm},
            )
        )
        .mappings()
        .first()
    )

    row = (
        None
        if record is None
        else CountryRequirementsRow(
            profile=record["profile"],
            national_id_required=record["national_id_required"],
            national_id_length=record["national_id_length"],
            national_id_regex=record["national_id_regex"],
            phone_regex=record["phone_regex"],
            required_documents=list(record["required_documents"]),
        )
    )
    return CountryRequirementsResponse.resolve(norm, row)
