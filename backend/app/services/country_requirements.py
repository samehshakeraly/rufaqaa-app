"""Shared loader for a country's ``country_requirements`` row.

Two callers need the same row, loaded the same way: the read endpoint
(``GET /countries/{code}/requirements`` in :mod:`app.api.v1.countries`) and the
conditional ``national_id`` validation in
:func:`app.services.orphans.create_orphan_record`. This is the single place that
turns a country code into a :class:`CountryRequirementsRow` — or ``None`` when
the country has no row, which both callers treat as the permissive baseline via
:meth:`app.schemas.country.CountryRequirementsResponse.resolve`.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.country_requirements import CountryRequirementsRow


async def load_requirements_row(db: AsyncSession, code: str) -> CountryRequirementsRow | None:
    """Load the ``country_requirements`` row for ``code`` (ISO alpha-2).

    ``code`` is normalised to upper-case. Returns ``None`` when no row exists —
    a valid-but-unconfigured (or unknown) country, which resolves to the
    permissive baseline. This does NOT assert that ``code`` is a real country;
    the read endpoint keeps that separate 404 guard.
    """
    record = (
        (
            await db.execute(
                text(
                    "SELECT profile, national_id_required, national_id_length, "
                    "national_id_regex, phone_regex, required_documents "
                    "FROM country_requirements WHERE country_code = :code"
                ),
                {"code": code.upper()},
            )
        )
        .mappings()
        .first()
    )
    if record is None:
        return None
    return CountryRequirementsRow(
        profile=record["profile"],
        national_id_required=record["national_id_required"],
        national_id_length=record["national_id_length"],
        national_id_regex=record["national_id_regex"],
        phone_regex=record["phone_regex"],
        required_documents=list(record["required_documents"]),
    )
