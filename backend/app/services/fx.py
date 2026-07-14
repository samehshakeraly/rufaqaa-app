"""FX helpers — the single home of exchange-rate lookups and conversion math.

Rates come EXCLUSIVELY from the admin-maintained, org-scoped
``exchange_rates`` table (:class:`app.models.exchange_rate.ExchangeRate`);
there is deliberately no external FX call anywhere in the platform.

.. note:: Future seam — a scheduled refresh job MAY populate
   ``exchange_rates`` from an external source one day. If it ever does, it
   must go through the same table (insert new ``effective_at`` rows); this
   module stays a pure reader either way.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.exchange_rate import ExchangeRate

_TWO_PLACES = Decimal("0.01")


async def get_rate(
    db: AsyncSession,
    *,
    organization_id: UUID,
    base_currency: str,
    quote_currency: str,
    as_of: datetime | None = None,
) -> Decimal | None:
    """Most recent admin-recorded rate for ``base -> quote`` in the org.

    Returns the rate row with the newest ``effective_at <= as_of`` (``now``
    when ``as_of`` is None), filtered EXPLICITLY by ``organization_id`` —
    the app's superuser connection bypasses RLS. Currency codes are
    upper-cased before comparison so ``"usd" -> "USD"`` behaves like
    ``"USD" -> "USD"``.

    ``base == quote`` short-circuits to ``Decimal(1)`` WITHOUT touching the
    DB. No matching row returns ``None`` — the caller decides whether that
    fails closed (gateway payments) or is tolerated (manual recording).
    """
    base = base_currency.upper()
    quote = quote_currency.upper()
    if base == quote:
        return Decimal(1)

    when = as_of if as_of is not None else datetime.now(UTC)
    rate: Decimal | None = await db.scalar(
        select(ExchangeRate.rate)
        .where(
            ExchangeRate.organization_id == organization_id,
            ExchangeRate.base_currency == base,
            ExchangeRate.quote_currency == quote,
            ExchangeRate.effective_at <= when,
        )
        .order_by(ExchangeRate.effective_at.desc())
        .limit(1)
    )
    return rate


def convert(amount: Decimal, rate: Decimal) -> Decimal:
    """``amount`` (base currency) × ``rate`` → quote currency, 2 dp.

    The ONLY place conversion math lives. Quantizes to 2 decimal places
    with ROUND_HALF_UP, matching the NUMERIC(10,2) money columns.
    """
    return (amount * rate).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
