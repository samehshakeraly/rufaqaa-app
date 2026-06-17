import csv
import io
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.api.scoping import get_in_org_or_404
from app.core.authz import ADMIN_ROLES, FINANCE_ROLES, require_roles
from app.models.donor import Donor
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.schemas.common import Page
from app.schemas.donor import DonorCreate, DonorRead, DonorUpdate
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


@router.get("", response_model=Page[DonorRead])
async def list_donors(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[DonorRead]:
    stmt = select(Donor).where(
        Donor.organization_id == user.organization_id, Donor.deleted_at.is_(None)
    )
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


_CSV_COLUMNS = (
    "code",
    "full_name",
    "email",
    "phone",
    "country_of_residence",
    "preferred_currency",
    "status",
    "total_sponsorships",
    "active_sponsorships",
    "total_donated",
    "created_at",
)


@router.get("/export.csv")
async def export_donors_csv(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
) -> StreamingResponse:
    """Stream every non-deleted donor in this org as CSV, capped at
    10 000 rows. Tighten the org / future filters if you need to export
    more — pagination won't help with CSV."""
    stmt = (
        select(Donor)
        .where(
            Donor.organization_id == user.organization_id,
            Donor.deleted_at.is_(None),
        )
        .order_by(Donor.created_at.desc())
        .limit(10_000)
    )
    rows = (await db.scalars(stmt)).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_COLUMNS)
    for d in rows:
        writer.writerow(
            [
                d.code,
                d.full_name,
                d.email,
                d.phone or "",
                d.country_of_residence or "",
                d.preferred_currency or "",
                d.status,
                d.total_sponsorships or 0,
                d.active_sponsorships or 0,
                str(d.total_donated or 0),
                d.created_at.isoformat(),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rufaqaa-donors.csv"'},
    )


@router.post("", response_model=DonorRead, status_code=status.HTTP_201_CREATED)
async def create_donor(
    payload: DonorCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
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
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="donor.created",
        entity_type="donor",
        entity_id=donor.id,
        new_values={"code": donor.code, "email": donor.email},
    )
    await db.commit()
    await db.refresh(donor)
    return DonorRead.model_validate(donor)


@router.get("/{donor_id}", response_model=DonorRead)
async def get_donor(
    donor_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
) -> DonorRead:
    donor = await get_in_org_or_404(db, Donor, donor_id, user, Donor.deleted_at.is_(None))
    return DonorRead.model_validate(donor)


@router.patch("/{donor_id}", response_model=DonorRead)
async def update_donor(
    donor_id: UUID,
    payload: DonorUpdate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*FINANCE_ROLES))],
) -> DonorRead:
    donor = await get_in_org_or_404(db, Donor, donor_id, user, Donor.deleted_at.is_(None))

    changes: dict[str, dict[str, object]] = {}
    for field, value in payload.model_dump(exclude_unset=True).items():
        old = getattr(donor, field)
        if old != value:
            changes[field] = {"old": old, "new": value}
            setattr(donor, field, value)

    if changes:
        record_audit(
            db,
            organization_id=user.organization_id,
            user_id=user.id,
            action="donor.updated",
            entity_type="donor",
            entity_id=donor.id,
            old_values={
                k: str(v["old"]) if v["old"] is not None else None for k, v in changes.items()
            },
            new_values={
                k: str(v["new"]) if v["new"] is not None else None for k, v in changes.items()
            },
        )
    await db.commit()
    await db.refresh(donor)
    return DonorRead.model_validate(donor)


@router.post("/{donor_id}/restore", response_model=DonorRead)
async def restore_donor(
    donor_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> DonorRead:
    """Clear deleted_at so a soft-deleted donor is visible again."""
    donor = await get_in_org_or_404(db, Donor, donor_id, user, Donor.deleted_at.is_not(None))
    donor.deleted_at = None
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="donor.restored",
        entity_type="donor",
        entity_id=donor.id,
        new_values={"code": donor.code},
    )
    await db.commit()
    await db.refresh(donor)
    return DonorRead.model_validate(donor)


@router.delete("/{donor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_donor(
    donor_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> None:
    """Soft-delete a donor. Refuses if any sponsorship is still active —
    cancel those first so the audit trail is honest about why money stops.
    """
    donor = await get_in_org_or_404(db, Donor, donor_id, user, Donor.deleted_at.is_(None))

    active = await db.scalar(
        select(func.count(Sponsorship.id)).where(
            Sponsorship.donor_id == donor_id,
            Sponsorship.status.in_(("active", "paused", "overdue")),
        )
    )
    if (active or 0) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Donor has {active} active sponsorship(s) — cancel them first",
        )

    donor.deleted_at = datetime.now(UTC)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="donor.deleted",
        entity_type="donor",
        entity_id=donor.id,
        old_values={"code": donor.code, "email": donor.email},
        is_sensitive=True,
    )
    await db.commit()
