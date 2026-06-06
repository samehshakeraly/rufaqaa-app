"""User → partner organization link — scope a user to a single جهة.

Adds a single NULLABLE FK, ``users.partner_organization_id``, pointing at the
``partner_organizations`` row a partner user belongs to. NULL keeps its natural
meaning: the user is not tied to any one جهة (the case for every user today).
``ON DELETE SET NULL`` mirrors the soft coupling — archiving/removing a partner
organization simply unsets the link rather than blocking the delete.

Foundation only: PURELY ADDITIVE plumbing for assigning a user to a جهة. No
list filtering, no creation/assignment enforcement, and no visibility/scoping
behaviour rides on it yet (those come in later batches). The canonical schema
file (``docs/technical/01_database_schema.sql``) is the baseline loaded by 0001
and is deliberately NOT edited; every delta lives here.

Fully reversible: ``downgrade`` drops the index and the column (the inline FK is
dropped with the column).

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── users.partner_organization_id: NULLABLE FK to the partner org (جهة) a
    #    user belongs to. The inline FK mirrors the other user FK
    #    (organization_id); ON DELETE SET NULL unsets the link if the partner
    #    org is removed rather than blocking the delete. ──
    op.execute(
        "ALTER TABLE users ADD COLUMN partner_organization_id UUID "
        "REFERENCES partner_organizations(id) ON DELETE SET NULL"
    )
    op.create_index("idx_users_partner_organization_id", "users", ["partner_organization_id"])


def downgrade() -> None:
    # Drop the index first, then the column — its inline FK goes with it.
    op.drop_index("idx_users_partner_organization_id", table_name="users")
    op.drop_column("users", "partner_organization_id")
