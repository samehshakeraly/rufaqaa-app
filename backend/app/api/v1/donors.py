from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.donor import Donor
from app.schemas.common import Page
from app.schemas.donor import DonorCreate, DonorRead
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[DonorRead])
async def list_donors(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[DonorRead]:
    stmt = select(Donor).where(Donor.deleted_at.is_(None))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Donor.created_at.desc()).limit(limit).offset(offset))
    ).all()

    return Page(
        items=[DonorRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=DonorRead, status_code=status.HTTP_201_CREATED)
async def create_donor(
    payload: DonorCreate,
    db: DbSession,
    user: CurrentUser,
) -> DonorRead:
    donor = Donor(
        organization_id=user.organization_id,
        code=generate_code("DON"),
        full_name=payload.full_name,
        full_name_en=payload.full_name_en,
        email=payload.email,
        phone=payload.phone,
        whatsapp=payload.whatsapp,
        nationality=payload.nationality,
        country_of_residence=payload.country_of_residence,
        preferred_currency=payload.preferred_currency,
        is_anonymous=payload.is_anonymous,
        is_zakat_donor=payload.is_zakat_donor,
    )
    db.add(donor)
    await db.commit()
    await db.refresh(donor)
    return DonorRead.model_validate(donor)


@router.get("/{donor_id}", response_model=DonorRead)
async def get_donor(
    donor_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> DonorRead:
    donor = await db.scalar(select(Donor).where(Donor.id == donor_id, Donor.deleted_at.is_(None)))
    if donor is None:
        raise NotFound("Donor")
    return DonorRead.model_validate(donor)
