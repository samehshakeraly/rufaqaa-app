from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, or_, select, text

from app.api.deps import CurrentUser, DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.core.exceptions import NotFound
from app.models.orphan import Orphan
from app.models.user import User
from app.schemas.common import Page
from app.schemas.orphan import OrphanCreate, OrphanRead
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[OrphanRead])
async def list_orphans(
    db: DbSession,
    _user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    case_status: str | None = None,
    q: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> Page[OrphanRead]:
    """List orphans, optionally filtered by case_status and a search term.

    `q` does a Postgres full-text search against the trigger-maintained
    `search_vector` (covers Arabic + English name fields and the code) and
    also matches the code prefix directly so partial codes like "ORF-AB"
    still work.
    """
    stmt = select(Orphan).where(Orphan.deleted_at.is_(None))
    if case_status:
        stmt = stmt.where(Orphan.case_status == case_status)
    if q:
        # plainto_tsquery treats input as raw text and handles tokenisation,
        # which is safer than letting users craft tsquery operators.
        tsquery = func.plainto_tsquery("simple", q)
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                text("search_vector @@ plainto_tsquery('simple', :q)").bindparams(q=q),
                Orphan.code.ilike(like),
                Orphan.first_name.ilike(like),
                Orphan.family_name.ilike(like),
            )
        )
        # Rank: best matches first when a query was supplied
        stmt = stmt.order_by(
            text("ts_rank(search_vector, plainto_tsquery('simple', :q)) DESC").bindparams(q=q),
            Orphan.created_at.desc(),
        )
        # Avoid the "unused" warning about tsquery — it's still useful as a
        # readable reference even though we use raw text() above.
        _ = tsquery
    else:
        stmt = stmt.order_by(Orphan.created_at.desc())

    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await db.scalars(stmt.limit(limit).offset(offset))).all()

    return Page(
        items=[OrphanRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=OrphanRead, status_code=status.HTTP_201_CREATED)
async def create_orphan(
    payload: OrphanCreate,
    db: DbSession,
    user: CurrentUser,
) -> OrphanRead:
    orphan = Orphan(
        organization_id=user.organization_id,
        partner_organization_id=payload.partner_organization_id,
        family_id=payload.family_id,
        code=generate_code("ORF"),
        first_name=payload.first_name,
        middle_name=payload.middle_name,
        family_name=payload.family_name,
        full_name_en=payload.full_name_en,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        nationality=payload.nationality,
        father_name=payload.father_name,
        father_death_date=payload.father_death_date,
        created_by=user.id,
    )
    db.add(orphan)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.created",
        entity_type="orphan",
        entity_id=orphan.id,
        new_values={"code": orphan.code, "case_status": orphan.case_status},
    )
    await db.commit()
    await db.refresh(orphan)
    return OrphanRead.model_validate(orphan)


@router.get("/{orphan_id}", response_model=OrphanRead)
async def get_orphan(
    orphan_id: UUID,
    db: DbSession,
    _user: CurrentUser,
) -> OrphanRead:
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    return OrphanRead.model_validate(orphan)


@router.delete("/{orphan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_orphan(
    orphan_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Soft-delete an orphan record. Restricted to org admins."""
    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    orphan.deleted_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="orphan.deleted",
        entity_type="orphan",
        entity_id=orphan.id,
        old_values={"code": orphan.code},
        is_sensitive=True,
    )
    await db.commit()
