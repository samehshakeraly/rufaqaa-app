"""Admin-maintained, org-scoped exchange-rate table (R8-A2, currency base).

The canonical schema (0001) ships a LEGACY platform-global ``exchange_rates``
table (SERIAL PK, from/to FKs into ``currencies``, one row per DATE, a
``source`` column for an external feed that never existed). No model, query,
or endpoint has ever referenced it, and nothing seeds it — it is empty dead
weight occupying the name. This migration REPLACES it with the R8-A2 shape:
org-scoped, ``1 base_currency = rate quote_currency``, append-only history
keyed by ``effective_at`` TIMESTAMPTZ (the UNIQUE constraint keeps one row
per org/pair/instant), so lookups pick the most recent row with
``effective_at <= now`` (:func:`app.services.fx.get_rate`) — the ONLY rate
source in the platform; there is deliberately no external FX dependency.

The unique index — leading on ``organization_id`` — doubles as that lookup's
index; ``idx_exchange_rates_org`` backs plain org-scoped lists. ``rate``
carries a named CHECK (> 0); the Pydantic layer enforces the same bound at
the boundary, the CHECK is the DB-level backstop.

Fully reversible — downgrade drops the new table and recreates the legacy
one exactly as ``01_database_schema.sql`` defines it (both are empty, so no
data moves in either direction).

Revision ID: 0034
Revises: 0033
Create Date: 2026-07-14
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0034"
down_revision: str | Sequence[str] | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        -- Legacy platform-global table from 0001 — unreferenced and empty.
        DROP TABLE IF EXISTS exchange_rates;

        CREATE TABLE exchange_rates (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID NOT NULL REFERENCES organizations(id),

            -- 1 base_currency = <rate> quote_currency (quote is
            -- conventionally the org's default_currency).
            base_currency CHAR(3) NOT NULL,
            quote_currency CHAR(3) NOT NULL,
            rate NUMERIC(18,8) NOT NULL
                CONSTRAINT exchange_rates_rate_check CHECK (rate > 0),

            effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT uq_exchange_rates_org_pair_effective
                UNIQUE (organization_id, base_currency, quote_currency, effective_at)
        );
        CREATE INDEX idx_exchange_rates_org ON exchange_rates (organization_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS exchange_rates;

        -- Restore the legacy shape verbatim from 01_database_schema.sql.
        CREATE TABLE exchange_rates (
            id SERIAL PRIMARY KEY,
            from_currency CHAR(3) NOT NULL REFERENCES currencies(code),
            to_currency CHAR(3) NOT NULL REFERENCES currencies(code),
            rate DECIMAL(15, 6) NOT NULL,
            effective_date DATE NOT NULL,
            source VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (from_currency, to_currency, effective_date)
        );
        CREATE INDEX idx_exchange_rates_date ON exchange_rates(effective_date DESC);
        """
    )
