"""Platform-level settings singleton (B-6).

Adds a single-row `platform_settings` table holding system-wide flags
(maintenance_mode, signups_open, default_subscription_plan, …) managed
only by super_admin. It is deliberately NOT a tenant table: no
organization_id, no RLS policy. The id column is pinned to 1 by a CHECK
constraint so there is always exactly one row, which is seeded here.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE platform_settings (
            id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            settings JSONB DEFAULT '{}' NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            updated_by UUID REFERENCES users(id)
        );
        INSERT INTO platform_settings (id, settings) VALUES (1, '{}');
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_settings;")
