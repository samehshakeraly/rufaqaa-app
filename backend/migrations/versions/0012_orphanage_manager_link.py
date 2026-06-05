"""Orphanage manager link — assign a dar to the staff user who runs it.

Builds on migration 0011's orphanage foundation. Adds a single nullable FK,
``orphanages.manager_user_id``, pointing at the ``users`` row of the
``orphanage_manager`` who runs the dar (the role 0011 introduced). NULL keeps
its natural meaning: the dar has no manager assigned yet.

A UNIQUE constraint (``orphanages_manager_user_id_key``) enforces the
one-dar-per-manager rule in the database — a user manages at most one
orphanage — so a double assignment fails loudly instead of silently
duplicating. (The API layer pre-checks the same rule to return a clean 400
rather than surfacing a raw unique-violation 409.) A UNIQUE column still
admits many NULLs, so any number of dars may sit unassigned.

Foundation for the manager portal — no portal / endpoint behaviour rides on
this yet. Fully reversible: ``downgrade`` drops the column, and its inline FK
and the UNIQUE constraint are dropped with it.

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-05
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── orphanages.manager_user_id: NULLABLE FK to the managing user. The
    #    inline FK mirrors the other user FKs on the table (created_by); the
    #    UNIQUE constraint caps it at one dar per manager. ──
    op.execute("ALTER TABLE orphanages ADD COLUMN manager_user_id UUID REFERENCES users(id)")
    op.execute(
        "ALTER TABLE orphanages "
        "ADD CONSTRAINT orphanages_manager_user_id_key UNIQUE (manager_user_id)"
    )


def downgrade() -> None:
    # Drop the column — its inline FK and the UNIQUE constraint go with it.
    op.drop_column("orphanages", "manager_user_id")
