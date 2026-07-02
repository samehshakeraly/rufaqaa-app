"""Public, no-auth-required read endpoints.

These are the only surfaces an anonymous visitor sees. Every shape
exposed here is hand-curated to a narrow, donor-safe subset — no full
DOB, no address, no guardian / family / document / donor-history /
internal-status information. The Pydantic models are the contract;
broadening them is a security review, not a casual change.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field, computed_field
from sqlalchemy import desc, func, select

from app.api.deps import DbSession
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.sponsorship import Sponsorship
from app.schemas.orphan import OrphanStatus, derive_orphan_status

router = APIRouter()

# Cases that anonymous visitors can browse + sponsor. Anything else
# (pending_review, archived, deceased, …) is hidden.
_BROWSEABLE_CASE_STATUSES = ("available", "approved", "reserved")


class PublicOrphanCard(BaseModel):
    """Curated public projection of an orphan. Every field here was
    chosen because it is safe to show an anonymous visitor."""

    model_config = ConfigDict(from_attributes=False)

    code: str
    first_name: str
    age_years: int
    gender: Literal["M", "F"]
    country: str | None
    case_status: str
    partner_organization_name: str | None


class PublicOrphanDetail(PublicOrphanCard):
    """Detail page — the card fields plus a curated, donor-safe slice of the
    humanizing profile: aspiration, education stage, Qur'an progress, and the
    hobby / talent / segment tags.

    Sensitive profile data — health status / coverage, chronic conditions,
    challenges, school name, academic level, family and document info — is
    deliberately NOT exposed here; it stays internal to staff/guardian views.
    Broadening this set is a security review, not a casual change."""

    short_description: str | None = None
    aspiration: str | None = None
    # Enum *code* (e.g. "primary"); the frontend localizes the label.
    education_stage: str | None = None
    quran_juz_memorized: int | None = None
    tags: list[str] = Field(default_factory=list)
    # Small identity additions (R1). ``languages`` the child speaks;
    # ``orphan_status`` is DERIVED from mother_status (never stored) — the
    # coded value ("father"/"both"), localized by the frontend.
    languages: list[str] = Field(default_factory=list)
    orphan_status: OrphanStatus

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_hafiz(self) -> bool:
        """Derived (not stored): a child who has memorised the whole Qur'an."""
        return self.quran_juz_memorized == 30


class PublicPage(BaseModel):
    items: list[PublicOrphanCard]
    total: int
    limit: int
    offset: int


class PublicStats(BaseModel):
    orphans_available: int
    orphans_sponsored: int
    donors_total: int
    countries_served: int


def _age_years(dob: date) -> int:
    today = datetime.now(UTC).date()
    years = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        years -= 1
    return max(years, 0)


def _to_card(orphan: Orphan, partner_name: str | None) -> PublicOrphanCard:
    return PublicOrphanCard(
        code=orphan.code,
        first_name=orphan.first_name,
        age_years=_age_years(orphan.date_of_birth),
        gender=orphan.gender,
        country=orphan.nationality,
        case_status=orphan.case_status,
        partner_organization_name=partner_name,
    )


def to_public_detail(orphan: Orphan, partner_name: str | None) -> PublicOrphanDetail:
    """Project an orphan row into the canonical donor-safe detail shape.

    Single source of truth for the safe profile slice: the public detail
    endpoint and the donor-scoped sponsorship-profile endpoint both build
    their response through here, so the exposed field set can only ever be
    ``PublicOrphanDetail`` — never broadened by accident on one surface."""
    card = _to_card(orphan, partner_name)
    return PublicOrphanDetail(
        **card.model_dump(),
        short_description=None,  # placeholder until partners author this
        aspiration=orphan.aspiration,
        education_stage=orphan.education_stage,
        quran_juz_memorized=orphan.quran_juz_memorized,
        tags=orphan.tags,
        languages=orphan.languages,
        orphan_status=derive_orphan_status(orphan.mother_status),
    )


@router.get("/orphans", response_model=PublicPage)
async def public_list_orphans(
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    country: str | None = Query(default=None, min_length=2, max_length=2),
    gender: Literal["M", "F"] | None = None,
    min_age: int | None = Query(default=None, ge=0, le=25),
    max_age: int | None = Query(default=None, ge=0, le=25),
) -> PublicPage:
    """Anonymous-safe orphan listing. Always filters to case statuses a
    visitor is allowed to sponsor; never exposes archived / deceased /
    pending_review rows."""
    stmt = (
        select(Orphan, PartnerOrganization.name_ar)
        .outerjoin(
            PartnerOrganization,
            PartnerOrganization.id == Orphan.partner_organization_id,
        )
        .where(
            Orphan.deleted_at.is_(None),
            Orphan.case_status.in_(_BROWSEABLE_CASE_STATUSES),
        )
    )
    if country:
        stmt = stmt.where(Orphan.nationality == country.upper())
    if gender:
        stmt = stmt.where(Orphan.gender == gender)
    if min_age is not None or max_age is not None:
        # crude age window via dob bounds — exact enough for filtering
        today = datetime.now(UTC).date()
        if max_age is not None:
            stmt = stmt.where(
                Orphan.date_of_birth >= date(today.year - max_age - 1, today.month, today.day)
            )
        if min_age is not None:
            stmt = stmt.where(
                Orphan.date_of_birth <= date(today.year - min_age, today.month, today.day)
            )

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.execute(stmt.order_by(desc(Orphan.created_at)).limit(limit).offset(offset))
    ).all()
    items = [_to_card(orphan, partner_name) for orphan, partner_name in rows]
    return PublicPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/orphans/{code}", response_model=PublicOrphanDetail)
async def public_orphan_detail(code: str, db: DbSession) -> PublicOrphanDetail:
    row = (
        await db.execute(
            select(Orphan, PartnerOrganization.name_ar)
            .outerjoin(
                PartnerOrganization,
                PartnerOrganization.id == Orphan.partner_organization_id,
            )
            .where(
                Orphan.code == code,
                Orphan.deleted_at.is_(None),
                Orphan.case_status.in_(_BROWSEABLE_CASE_STATUSES),
            )
        )
    ).first()
    if row is None:
        raise NotFound("Orphan")
    orphan, partner_name = row
    return to_public_detail(orphan, partner_name)


@router.get("/stats", response_model=PublicStats)
async def public_stats(db: DbSession) -> PublicStats:
    """Platform-wide counters for the landing page. Aggregates only —
    no rowwise data leaves the database."""
    orphans_available = (
        await db.scalar(
            select(func.count(Orphan.id)).where(
                Orphan.deleted_at.is_(None),
                Orphan.case_status.in_(_BROWSEABLE_CASE_STATUSES),
            )
        )
        or 0
    )
    orphans_sponsored = (
        await db.scalar(
            select(func.count(Orphan.id)).where(
                Orphan.deleted_at.is_(None),
                Orphan.case_status == "sponsored",
            )
        )
        or 0
    )
    donors_total = (
        await db.scalar(select(func.count(Donor.id)).where(Donor.deleted_at.is_(None))) or 0
    )
    countries_served = (
        await db.scalar(
            select(func.count(func.distinct(Orphan.nationality))).where(
                Orphan.deleted_at.is_(None),
                Orphan.nationality.is_not(None),
            )
        )
        or 0
    )
    return PublicStats(
        orphans_available=int(orphans_available),
        orphans_sponsored=int(orphans_sponsored),
        donors_total=int(donors_total),
        countries_served=int(countries_served),
    )


_ = (Sponsorship, Decimal, UUID)  # imports kept for future expansion
