"""Apply the canonical SQL schema from docs/technical/01_database_schema.sql.

This first migration loads the hand-written schema (24 tables + RLS policies +
indexes + seed data) verbatim. Subsequent migrations will be auto-generated
from the SQLAlchemy models.

Revision ID: 0001
Revises:
Create Date: 2026-05-24
"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


SCHEMA_FILE = (
    Path(__file__).resolve().parents[2].parent
    / "docs"
    / "technical"
    / "01_database_schema.sql"
)


def upgrade() -> None:
    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    op.execute(sa_text_safe(sql))


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS api_keys, webhook_deliveries, webhook_endpoints,
            business_rules, audit_log, notifications, messages,
            bank_transfer_items, bank_transfers, payments, sponsorships,
            donors, media, orphan_reports, documents, orphans, guardians,
            families, marketing_channels, partner_organizations,
            exchange_rates, currencies, countries, user_sessions, users,
            organizations CASCADE;
        """
    )


def sa_text_safe(sql: str) -> str:
    """Alembic op.execute accepts raw SQL strings — this is a no-op pass-through
    kept for clarity (and to centralize any future preprocessing)."""
    return sql
