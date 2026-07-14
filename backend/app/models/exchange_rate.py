"""ORM mapping for the ``exchange_rates`` table (migration 0034).

ADMIN-MAINTAINED, org-scoped FX table — the ONLY source of exchange rates
in the platform (no external FX dependency). One row per
(org, base, quote, effective_at): ``1 base_currency = rate quote_currency``,
where the quote side is conventionally the org's ``default_currency``.
Rows are never updated in place — a rate change inserts a NEW row with a
fresh ``effective_at``, so the table keeps a full history and lookups pick
the most recent row with ``effective_at <= now`` (see
:func:`app.services.fx.get_rate`).

Tenant-owned via ``organization_id`` — every query filters it EXPLICITLY;
the app's superuser connection bypasses RLS.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import CHAR, CheckConstraint, ForeignKey, Index, Numeric, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (
        # History is append-only: one row per (org, pair, effective_at). The
        # backing unique index — leading on organization_id — also serves the
        # most-recent-rate lookup, so no separate lookup index is needed.
        UniqueConstraint(
            "organization_id",
            "base_currency",
            "quote_currency",
            "effective_at",
            name="uq_exchange_rates_org_pair_effective",
        ),
        CheckConstraint("rate > 0", name="exchange_rates_rate_check"),
        Index("idx_exchange_rates_org", "organization_id"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=False
    )

    # 1 base_currency = <rate> quote_currency (e.g. 1 USD = 0.30700000 KWD).
    base_currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    quote_currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)

    effective_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    created_by: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
