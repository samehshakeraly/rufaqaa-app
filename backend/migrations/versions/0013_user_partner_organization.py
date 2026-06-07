"""User → partner organization link — foundation for partner-scoped users.

Adds ``users.partner_organization_id``: a NULLABLE FK to
``partner_organizations`` so an org admin can tie a partner user (a
``partner_manager`` / ``partner_staff``) to a single جهة. NULL keeps its
natural meaning — the user is not scoped to any one partner organization.

This is PURELY ADDITIVE plumbing — the data foundation for partner-scoped
visibility. No list filtering, creation enforcement, or role restriction rides
on the column yet; those land in later batches. ``ON DELETE SET NULL`` mirrors
the SET-NULL FKs already in the canonical schema: removing the target partner
clears the link instead of blocking the delete.

The canonical schema file (``docs/technical/01_database_schema.sql``) is the
0001 baseline and is deliberately NOT edited; every delta lives here. Fully
reversible: ``downgrade`` drops the index then the column (its inline FK goes
with it).

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── users.partner_organization_id: NULLABLE FK to the user's جهة. The
    #    inline FK mirrors the other FKs on the table; ON DELETE SET NULL
    #    clears the link when the referenced partner org is removed. ──
    op.execute(
        "ALTER TABLE users ADD COLUMN partner_organization_id UUID "
        "REFERENCES partner_organizations(id) ON DELETE SET NULL"
    )
    op.create_index("idx_users_partner", "users", ["partner_organization_id"])


def downgrade() -> None:
    # Drop the index, then the column — its inline FK is dropped with it.
    op.drop_index("idx_users_partner", table_name="users")
    op.drop_column("users", "partner_organization_id")
