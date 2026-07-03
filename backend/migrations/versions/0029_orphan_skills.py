"""Per-orphan skills/talents — staff CRUD + gated donor block (R5).

Creates the NEW ``orphan_skills`` table (mirroring the media table's org/orphan
FK pattern): one row per skill or talent a staff member records for a child.

* ``name`` — VARCHAR(60) NOT NULL, the skill's display label.
* ``category`` / ``level`` — short coded values, NULLable, validated in the
  Pydantic layer only (no DB CHECK constraints — the same pattern as
  ``health_status``). These two are the ONLY qualifiers that may ever reach a
  donor (the frontend localizes them).
* ``note`` — TEXT, STAFF-ONLY free text; it never leaves the staff surface.

The composite (``organization_id``, ``orphan_id``) index backs the explicitly
org-scoped list/donor queries — the app's superuser connection bypasses RLS,
so every read filters by ``organization_id`` in code.

Fully reversible — downgrade drops the table.

Revision ID: 0029
Revises: 0028
Create Date: 2026-07-03
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE orphan_skills (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID NOT NULL REFERENCES organizations(id),
            orphan_id UUID NOT NULL REFERENCES orphans(id) ON DELETE CASCADE,

            name VARCHAR(60) NOT NULL,
            category VARCHAR(30),  -- coded (Pydantic-validated), donor-visible
            level VARCHAR(20),     -- coded (Pydantic-validated), donor-visible
            note TEXT,             -- STAFF-ONLY free text, never donor-facing

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_orphan_skills_org_orphan
            ON orphan_skills (organization_id, orphan_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS orphan_skills;")
