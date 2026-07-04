"""Wishes + needs entities and the entity-linked donation columns (R7).

Creates TWO new per-orphan tables (mirroring the ``orphan_skills`` org/orphan
FK pattern) — the DATA layer only; no payment execution lands here (that is
R8, the MyFatoorah webhook):

* ``orphan_wishes`` — one row per concrete, donor-fundable wish. ``title`` is
  the display label; ``description`` is the donor-facing, staff-authored
  pitch; ``internal_note`` is STAFF-ONLY free text and never leaves the staff
  surface. Money mirrors ``payments`` exactly: ``target_amount`` NUMERIC(10,2)
  + ``currency`` VARCHAR(3). ``raised_amount`` is SYSTEM-managed (default 0;
  only R8's webhook will ever move it). ``status`` is coded
  (open/fulfilled/archived), validated in the Pydantic layer only (no DB
  CHECK — the ``health_status`` pattern).
* ``orphan_needs`` — identical shape plus a coded, NULLable ``category``
  (rent/medicine/supplies/…), status coded open/met/archived.

Adds to ``payments`` the two NULLable columns that let a FUTURE one-time
donation point at a wish or a need — ``target_type`` VARCHAR(20) (coded:
wish/need) + ``target_id`` UUID. No DB CHECK (validated in Pydantic when R8
wires them) and no behavioral change to any existing payment flow.

The composite (``organization_id``, ``orphan_id``) indexes back the explicitly
org-scoped list/donor queries — the app's superuser connection bypasses RLS,
so every read filters by ``organization_id`` in code.

Fully reversible — downgrade drops the two payments columns, then both tables.

Revision ID: 0031
Revises: 0030
Create Date: 2026-07-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0031"
down_revision: str | Sequence[str] | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE orphan_wishes (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID NOT NULL REFERENCES organizations(id),
            orphan_id UUID NOT NULL REFERENCES orphans(id) ON DELETE CASCADE,

            title VARCHAR(120) NOT NULL,
            description TEXT,           -- donor-facing, staff-authored pitch
            internal_note TEXT,         -- STAFF-ONLY free text, never donor-facing

            target_amount NUMERIC(10,2) NOT NULL,
            currency VARCHAR(3) NOT NULL,
            raised_amount NUMERIC(10,2) NOT NULL DEFAULT 0,  -- SYSTEM-managed (R8 webhook)
            status VARCHAR(20) NOT NULL DEFAULT 'open',      -- coded: open/fulfilled/archived

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_orphan_wishes_org_orphan
            ON orphan_wishes (organization_id, orphan_id);

        CREATE TABLE orphan_needs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID NOT NULL REFERENCES organizations(id),
            orphan_id UUID NOT NULL REFERENCES orphans(id) ON DELETE CASCADE,

            title VARCHAR(120) NOT NULL,
            description TEXT,           -- donor-facing, staff-authored pitch
            internal_note TEXT,         -- STAFF-ONLY free text, never donor-facing
            category VARCHAR(30),       -- coded (Pydantic-validated), donor-visible

            target_amount NUMERIC(10,2) NOT NULL,
            currency VARCHAR(3) NOT NULL,
            raised_amount NUMERIC(10,2) NOT NULL DEFAULT 0,  -- SYSTEM-managed (R8 webhook)
            status VARCHAR(20) NOT NULL DEFAULT 'open',      -- coded: open/met/archived

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_orphan_needs_org_orphan
            ON orphan_needs (organization_id, orphan_id);
        """
    )
    # Future one-time donations point at a wish/need through these two
    # NULLable columns — additive only, zero impact on existing payment flows.
    op.add_column(
        "payments",
        sa.Column("target_type", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("target_id", UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payments", "target_id")
    op.drop_column("payments", "target_type")
    op.execute("DROP TABLE IF EXISTS orphan_needs;")
    op.execute("DROP TABLE IF EXISTS orphan_wishes;")
