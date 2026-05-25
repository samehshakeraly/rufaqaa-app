from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.models.partner import PartnerOrganization
from app.schemas.common import Page
from app.schemas.partner import PartnerRead

router = APIRouter()


@router.get("", response_model=Page[PartnerRead])
async def list_partners(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PartnerRead]:
    stmt = select(PartnerOrganization).where(PartnerOrganization.status == "active")
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(
            stmt.order_by(PartnerOrganization.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=[PartnerRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
