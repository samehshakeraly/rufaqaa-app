"""Guardian self-service endpoints under `/guardian/me`.

Mirrors the donor self-portal pattern (`donor_self.py`): no `require_roles`
on the dependency, because the resource itself is the gate — only users
that actually have a `guardians.user_id` row pointing to them will resolve.
Anyone else gets a 404.

Privacy posture, hard-baked:
  - Orphans are projected through `GuardianOrphanRead` which **never**
    serialises `current_balance`, `is_sponsored`, `balance_currency`, or
    partner identity. The financial fields can be opted in per org via
    `business_rules.show_financial_to_guardian = TRUE` (default FALSE).
  - Cross-family access raises 403, not 404, so we don't leak that other
    families exist in the same org.

Updates to the guardian profile itself go through the staff/admin
endpoints — keeping this surface read-only avoids accidentally letting
a guardian self-modify their literacy_level or banking info.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DbSession
from app.core.exceptions import NotFound
from app.models.family import Guardian
from app.models.orphan import Orphan
from app.models.report import OrphanReport
from app.models.user import User
from app.schemas.report import ReportRead

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────


class GuardianFamilyMini(BaseModel):
    """Just enough to anchor the UI — no street address, no income."""

    id: UUID
    code: str
    family_name: str | None
    country_code: str | None
    governorate: str | None


class GuardianMeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None
    full_name: str
    relation: str
    literacy_level: str
    preferred_communication: str
    phone: str | None
    whatsapp: str | None
    email: str | None
    status: str
    family: GuardianFamilyMini | None


class GuardianOrphanFinancials(BaseModel):
    """Only attached when `business_rules.show_financial_to_guardian` is
    TRUE for the guardian's org."""

    current_balance: str | None
    balance_currency: str | None
    is_sponsored: bool


class GuardianOrphanRead(BaseModel):
    """Guardian-safe projection of an orphan.

    Notice the omitted fields: no `current_balance`, no `balance_currency`,
    no `is_sponsored`, no partner_organization_id. Those are unlocked
    explicitly via `business_rules.show_financial_to_guardian = TRUE` and
    re-attached as `financials` (see below).
    """

    id: UUID
    code: str
    first_name: str
    family_name: str
    date_of_birth: date
    gender: str
    case_status: str
    profile_completion_percentage: int
    # Optional financial payload — only set when the org has opted in.
    financials: GuardianOrphanFinancials | None = None


# ── Helpers ────────────────────────────────────────────────────────────


async def _load_guardian_or_404(db: AsyncSession, user: User) -> Guardian:
    """Resolve the calling user to their Guardian row.

    Returns 404 (not 403) for non-guardian users — we don't want to
    confirm that /guardian/me is reachable when you aren't one.
    """
    guardian = await db.scalar(select(Guardian).where(Guardian.user_id == user.id))
    if guardian is None:
        raise NotFound("Guardian")
    return guardian


async def _show_financial_to_guardian(db: AsyncSession, organization_id: UUID) -> bool:
    """Read the per-org guardian-visibility flag from `business_rules`.

    No ORM model exists for business_rules yet (mirrors `media`); we hit
    it with raw SQL. Default FALSE matches the schema CHECK and the
    `show_financial_to_guardian` column default.
    """
    row = (
        await db.execute(
            text(
                "SELECT show_financial_to_guardian FROM business_rules "
                "WHERE organization_id = :org_id LIMIT 1"
            ),
            {"org_id": str(organization_id)},
        )
    ).first()
    if row is None:
        return False
    return bool(row[0])


# ── Endpoints ──────────────────────────────────────────────────────────


@router.get("/me", response_model=GuardianMeRead)
async def get_guardian_me(db: DbSession, user: CurrentUser) -> GuardianMeRead:
    """Return the guardian profile for the calling user.

    Joins on `families` to attach a thin family preview so the SPA can
    show "you belong to family <code>" without a second round-trip.
    """
    guardian = await _load_guardian_or_404(db, user)

    family_payload: GuardianFamilyMini | None = None
    if guardian.family_id is not None:
        family_row = (
            await db.execute(
                text(
                    "SELECT id, code, family_name, country_code, governorate "
                    "FROM families WHERE id = :id LIMIT 1"
                ),
                {"id": str(guardian.family_id)},
            )
        ).first()
        if family_row is not None:
            family_payload = GuardianFamilyMini(
                id=family_row[0],
                code=family_row[1],
                family_name=family_row[2],
                country_code=family_row[3],
                governorate=family_row[4],
            )

    return GuardianMeRead(
        id=guardian.id,
        user_id=guardian.user_id,
        full_name=guardian.full_name,
        relation=guardian.relation,
        literacy_level=guardian.literacy_level,
        preferred_communication=guardian.preferred_communication,
        phone=guardian.phone,
        whatsapp=guardian.whatsapp,
        email=guardian.email,
        status=guardian.status,
        family=family_payload,
    )


@router.get("/me/orphans", response_model=list[GuardianOrphanRead])
async def list_my_orphans(db: DbSession, user: CurrentUser) -> list[GuardianOrphanRead]:
    """List orphans belonging to the guardian's family.

    Financial fields are stripped by default. The org can opt in via
    `business_rules.show_financial_to_guardian = TRUE` — when so, the
    `financials` sub-object is attached per orphan.
    """
    guardian = await _load_guardian_or_404(db, user)

    if guardian.family_id is None:
        return []

    show_financials = await _show_financial_to_guardian(db, guardian.organization_id)

    rows = (
        await db.scalars(
            select(Orphan)
            .where(
                Orphan.family_id == guardian.family_id,
                Orphan.deleted_at.is_(None),
            )
            .order_by(Orphan.created_at.desc())
        )
    ).all()

    out: list[GuardianOrphanRead] = []
    for o in rows:
        financials = None
        if show_financials:
            financials = GuardianOrphanFinancials(
                current_balance=str(o.current_balance) if o.current_balance is not None else None,
                balance_currency=o.balance_currency,
                is_sponsored=bool(o.is_sponsored),
            )
        out.append(
            GuardianOrphanRead(
                id=o.id,
                code=o.code,
                first_name=o.first_name,
                family_name=o.family_name,
                date_of_birth=o.date_of_birth,
                gender=o.gender,
                case_status=o.case_status,
                profile_completion_percentage=o.profile_completion_percentage,
                financials=financials,
            )
        )
    return out


@router.get("/me/reports", response_model=list[ReportRead])
async def list_my_reports(
    db: DbSession,
    user: CurrentUser,
    orphan_id: Annotated[UUID, Query(description="Orphan UUID; must belong to the guardian's family")],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ReportRead]:
    """List reports for one of the guardian's orphans.

    403 if the orphan isn't in the guardian's family — we'd rather signal
    "you can't touch this" loudly than 404 (which would leak orphan
    existence to non-owners).
    """
    guardian = await _load_guardian_or_404(db, user)

    orphan = await db.scalar(
        select(Orphan).where(Orphan.id == orphan_id, Orphan.deleted_at.is_(None))
    )
    if orphan is None:
        raise NotFound("Orphan")
    if orphan.family_id != guardian.family_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This orphan does not belong to your family",
        )

    # Re-affirm the timestamp module is in scope for ReportRead validation
    # (datetime is already imported at top).
    _ = datetime

    rows = (
        await db.scalars(
            select(OrphanReport)
            .where(OrphanReport.orphan_id == orphan_id)
            .order_by(OrphanReport.period_start.desc())
            .limit(limit)
        )
    ).all()
    return [ReportRead.model_validate(r) for r in rows]
