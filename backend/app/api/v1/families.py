from collections.abc import Sequence
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession
from app.core.authz import STAFF_ROLES, require_roles
from app.core.crypto import decrypt_field, encrypt_field
from app.core.exceptions import NotFound
from app.models.family import Family, Guardian
from app.models.user import User
from app.schemas.common import Page
from app.schemas.family import (
    FamilyCreate,
    FamilyRead,
    GuardianCreate,
    GuardianRead,
)
from app.services.audit import record_audit
from app.utils.codes import generate_code

router = APIRouter()


async def _family_coordinates(
    db: AsyncSession, family_ids: Sequence[UUID]
) -> dict[str, tuple[float | None, float | None]]:
    """Read each family's GPS as ``(latitude, longitude)`` from the
    ``families.coordinates`` POINT (PR E).

    The column is intentionally unmapped on the Family model, so we project it
    with a raw statement: ``ST_Y``/``ST_X`` over ``coordinates::geometry`` (the
    native POINT casts to a PostGIS geometry for the accessors). Only those two
    scalars are selected — the raw geometry is NEVER exposed. A NULL point yields
    ``(None, None)``. Keyed by ``str(id)`` so callers can look rows up by the
    family's stringified id. Empty input short-circuits with no query.
    """
    if not family_ids:
        return {}
    result = await db.execute(
        text(
            "SELECT id::text AS id, "
            "ST_Y(coordinates::geometry) AS latitude, "
            "ST_X(coordinates::geometry) AS longitude "
            "FROM families WHERE id::text = ANY(:ids)"
        ),
        {"ids": [str(fid) for fid in family_ids]},
    )
    return {
        row.id: (
            float(row.latitude) if row.latitude is not None else None,
            float(row.longitude) if row.longitude is not None else None,
        )
        for row in result
    }


def _read_family(
    family: Family, coords: dict[str, tuple[float | None, float | None]]
) -> FamilyRead:
    """Project a Family to ``FamilyRead``, attaching its GPS lat/lng from
    ``coords`` (absent / NULL point → null). Mirrors ``_serialize_guardian``'s
    fill-after-validate shape — latitude/longitude are not ORM attributes, so
    ``model_validate`` leaves them at their ``None`` default and we set them."""
    read = FamilyRead.model_validate(family)
    read.latitude, read.longitude = coords.get(str(family.id), (None, None))
    return read


@router.get("", response_model=Page[FamilyRead])
async def list_families(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[FamilyRead]:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS, so without this filter families leak across orgs.
    stmt = select(Family).where(Family.organization_id == user.organization_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Family.created_at.desc()).limit(limit).offset(offset))
    ).all()
    # One batched PostGIS lookup for the whole page's GPS, then attach per row.
    coords = await _family_coordinates(db, [r.id for r in rows])
    return Page(
        items=[_read_family(r, coords) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=FamilyRead, status_code=status.HTTP_201_CREATED)
async def create_family(
    payload: FamilyCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> FamilyRead:
    family = Family(
        organization_id=user.organization_id,
        partner_organization_id=payload.partner_organization_id,
        code=generate_code("FAM"),
        family_name=payload.family_name,
        deceased_father_name=payload.deceased_father_name,
        father_death_date=payload.father_death_date,
        father_death_cause=payload.father_death_cause,
        country_code=payload.country_code,
        governorate=payload.governorate,
        city=payload.city,
        district=payload.district,
        address_details=payload.address_details,
        village=payload.village,
        street=payload.street,
        house_number=payload.house_number,
        floor=payload.floor,
        monthly_income=payload.monthly_income,
        income_currency=payload.income_currency,
        housing_status=payload.housing_status,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(family)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="family.created",
        entity_type="family",
        entity_id=family.id,
        new_values={"code": family.code, "family_name": family.family_name},
    )
    await db.commit()
    await db.refresh(family)
    # A freshly created family carries no coordinates (this endpoint never sets
    # them — only the orphan-create GPS path does), so lat/lng read as null.
    return _read_family(family, {})


@router.get("/{family_id}", response_model=FamilyRead)
async def get_family(
    family_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> FamilyRead:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS. A cross-org id falls through to 404, never revealing it.
    family = await db.scalar(
        select(Family).where(
            Family.id == family_id,
            Family.organization_id == user.organization_id,
        )
    )
    if family is None:
        raise NotFound("Family")
    coords = await _family_coordinates(db, [family.id])
    return _read_family(family, coords)


# ─── Guardians live under /families because each guardian belongs to a
# family. A separate router would be over-engineering for now.


def _serialize_guardian(guardian: Guardian) -> GuardianRead:
    """Project a Guardian to ``GuardianRead``, decrypting national_id on read.

    national_id is stored only as the Fernet ciphertext in
    ``national_id_encrypted`` (the plaintext column was dropped in 0020), so
    ``GuardianRead.model_validate`` leaves the response's national_id at its
    ``None`` default. We decrypt the blob back onto the response when one is
    present (absent -> None) and never expose the ciphertext.
    """
    read = GuardianRead.model_validate(guardian)
    if guardian.national_id_encrypted is not None:
        read.national_id = decrypt_field(guardian.national_id_encrypted)
    return read


@router.get("/{family_id}/guardians", response_model=Page[GuardianRead])
async def list_guardians(
    family_id: UUID,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[GuardianRead]:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS. A cross-org family id falls through to 404.
    family = await db.scalar(
        select(Family).where(
            Family.id == family_id,
            Family.organization_id == user.organization_id,
        )
    )
    if family is None:
        raise NotFound("Family")
    stmt = select(Guardian).where(Guardian.family_id == family_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        await db.scalars(stmt.order_by(Guardian.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return Page(
        items=[_serialize_guardian(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/{family_id}/guardians",
    response_model=GuardianRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_guardian(
    family_id: UUID,
    payload: GuardianCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*STAFF_ROLES))],
) -> GuardianRead:
    # Explicit org scoping, never RLS — the app's superuser connection
    # bypasses RLS. A cross-org family id falls through to 404.
    family = await db.scalar(
        select(Family).where(
            Family.id == family_id,
            Family.organization_id == user.organization_id,
        )
    )
    if family is None:
        raise NotFound("Family")
    guardian = Guardian(
        organization_id=user.organization_id,
        family_id=family_id,
        full_name=payload.full_name,
        # Encrypt national_id at rest into national_id_encrypted (the plaintext
        # column was dropped in 0020). The staff read paths decrypt it back via
        # _serialize_guardian.
        national_id_encrypted=encrypt_field(payload.national_id) if payload.national_id else None,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        relation=payload.relation,
        occupation=payload.occupation,
        phone=payload.phone,
        whatsapp=payload.whatsapp,
        email=payload.email,
        literacy_level=payload.literacy_level,
        preferred_communication=payload.preferred_communication,
        status="active",
    )
    db.add(guardian)
    await db.flush()
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="guardian.created",
        entity_type="guardian",
        entity_id=guardian.id,
        new_values={"family_id": str(family_id), "relation": guardian.relation},
    )
    await db.commit()
    await db.refresh(guardian)
    return _serialize_guardian(guardian)
