"""Admin-maintained FX rate table (R8-A2).

The ``exchange_rates`` table is the ONLY source of currency conversion in
the platform — no external FX call anywhere. The same admin tier that sets
the org's ``default_currency`` (ADMIN_ROLES) maintains the rates, and every
payment write resolves ``payment currency -> org default currency`` through
:func:`app.services.fx.get_rate`.

Rates are append-only: an "upsert" records a NEW ``effective_at`` row rather
than mutating history, so past payments stay explainable by the table as it
was at their instant. Org scope is ALWAYS explicit, never RLS — the app's
superuser connection bypasses RLS.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.core.authz import ADMIN_ROLES, require_roles
from app.models.exchange_rate import ExchangeRate
from app.models.user import User
from app.schemas.exchange_rate import ExchangeRateCreate, ExchangeRateRead
from app.services.audit import record_audit

router = APIRouter()


@router.get("", response_model=list[ExchangeRateRead])
async def list_exchange_rates(
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> list[ExchangeRateRead]:
    """Full rate history for the caller's org, newest first per pair.

    Explicit org scope (never RLS). The table stays small — a handful of
    pairs × occasional updates — so no pagination; capped defensively.
    """
    rows = (
        await db.scalars(
            select(ExchangeRate)
            .where(ExchangeRate.organization_id == user.organization_id)
            .order_by(
                ExchangeRate.base_currency,
                ExchangeRate.quote_currency,
                ExchangeRate.effective_at.desc(),
            )
            .limit(1000)
        )
    ).all()
    return [ExchangeRateRead.model_validate(r) for r in rows]


@router.post("", response_model=ExchangeRateRead, status_code=status.HTTP_201_CREATED)
async def create_exchange_rate(
    payload: ExchangeRateCreate,
    db: DbSession,
    user: Annotated[User, Depends(require_roles(*ADMIN_ROLES))],
) -> ExchangeRateRead:
    """Record a new rate row for the caller's org (append-only upsert).

    ``base == quote`` is rejected — that conversion is identity by
    definition (:func:`app.services.fx.get_rate` returns 1 without a
    lookup), so a stored row could only ever contradict it. ``rate`` must
    be strictly positive; both violations are a clear 400.
    """
    base = payload.base_currency.upper()
    quote = payload.quote_currency.upper()
    if base == quote:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="base_currency and quote_currency must differ",
        )
    if payload.rate <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="rate must be greater than zero",
        )

    rate_row = ExchangeRate(
        organization_id=user.organization_id,
        base_currency=base,
        quote_currency=quote,
        rate=payload.rate,
        created_by=user.id,
    )
    if payload.effective_at is not None:
        rate_row.effective_at = payload.effective_at
    db.add(rate_row)
    record_audit(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        action="exchange_rate.created",
        entity_type="exchange_rate",
        new_values={
            "base_currency": base,
            "quote_currency": quote,
            "rate": str(payload.rate),
            "effective_at": (
                payload.effective_at.isoformat() if payload.effective_at is not None else None
            ),
        },
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A rate for this pair with the same effective_at already exists",
        ) from exc
    await db.refresh(rate_row)
    return ExchangeRateRead.model_validate(rate_row)
