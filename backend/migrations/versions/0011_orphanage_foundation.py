"""Orphanage (dar) layer — foundation schema only (no endpoints / API change).

Introduces the institutional-care counterpart to ``families``: a child is
either cared for in a family home (``orphans.family_id`` set, the existing
case) OR resident in a dar / orphanage. This migration lays only the data
foundation later batches build on:

* ``orphanages`` — a new org-scoped institution table modelled on
  ``families`` (same location + audit columns, the same RLS org-isolation
  policy, a ``DAR-XXXXX`` code) and adapted for an institution: ``name_ar`` /
  ``name_en`` and a ``status`` lifecycle.
* ``orphans.orphanage_id`` — a NULLABLE FK to ``orphanages``. NULL keeps its
  established meaning (family home / guardian); when set, the child is a
  resident of that dar. It complements ``family_id`` rather than replacing
  it — neither is forced here.
* ``orphanage_manager`` — a new value on the ``users_role_check`` role enum,
  for the staff who run a dar.

The canonical schema file (``docs/technical/01_database_schema.sql``) is the
baseline loaded by 0001 and is deliberately NOT edited; every delta lives
here. Fully reversible: ``downgrade`` restores the exact prior state,
including the original 10-value role CHECK.

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-05
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# The role CHECK is an inline column constraint in the canonical schema, so
# Postgres auto-named it ``users_role_check`` (confirmed against the live
# table). We swap the constraint wholesale rather than try to mutate its set.
_ROLES_BEFORE = (
    "'super_admin', 'org_admin', 'partner_manager', 'partner_staff', "
    "'marketing_manager', 'finance', 'donor', 'guardian', 'orphan', 'viewer'"
)
_ROLES_AFTER = _ROLES_BEFORE + ", 'orphanage_manager'"


def upgrade() -> None:
    # ── orphanages: mirrors the families DDL, adapted for an institution. ──
    # Written as raw SQL (like the canonical families table) for full fidelity
    # on the POINT column and the CHAR(2) FK to countries(code_alpha2).
    op.execute(
        """
        CREATE TABLE orphanages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            organization_id UUID NOT NULL REFERENCES organizations(id),
            partner_organization_id UUID REFERENCES partner_organizations(id),
            code VARCHAR(20) UNIQUE NOT NULL,  -- DAR-XXXXX

            name_ar VARCHAR(255) NOT NULL,
            name_en VARCHAR(255) NOT NULL,

            -- Location (mirrors families)
            country_code CHAR(2) REFERENCES countries(code_alpha2),
            governorate VARCHAR(100),
            city VARCHAR(100),
            district VARCHAR(100),
            address_details TEXT,
            coordinates POINT,  -- PostGIS

            status VARCHAR(20) NOT NULL DEFAULT 'active'
                CONSTRAINT orphanages_status_check
                CHECK (status IN ('active', 'inactive', 'archived')),

            notes TEXT,

            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            created_by UUID REFERENCES users(id)
        );
        """
    )
    op.create_index("idx_orphanages_org", "orphanages", ["organization_id"])
    op.create_index("idx_orphanages_partner", "orphanages", ["partner_organization_id"])
    op.create_index(
        "idx_orphanages_location", "orphanages", ["coordinates"], postgresql_using="gist"
    )

    # ── RLS: org isolation, mirroring families exactly. ──
    op.execute("ALTER TABLE orphanages ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY orphanages_org_isolation ON orphanages "
        "USING (organization_id = current_setting('app.current_org_id', true)::uuid)"
    )

    # ── orphans.orphanage_id: NULLABLE FK (NULL = family home / guardian,
    #    set = resident of a dar). Inline FK mirrors orphans.family_id. ──
    op.execute("ALTER TABLE orphans ADD COLUMN orphanage_id UUID REFERENCES orphanages(id)")
    op.create_index("idx_orphans_orphanage_id", "orphans", ["orphanage_id"])

    # ── users role enum: add 'orphanage_manager'. ──
    op.drop_constraint("users_role_check", "users", type_="check")
    op.create_check_constraint("users_role_check", "users", f"role IN ({_ROLES_AFTER})")


def downgrade() -> None:
    # Reverse precisely, in dependency-safe order.
    # 1. Restore the original 10-value role CHECK. Demote any rows still
    #    holding the new value first, so re-adding the stricter constraint
    #    can't fail (a no-op on a DB that never minted an orphanage_manager) —
    #    the same coalesce-before-tighten pattern as migration 0006's
    #    downgrade. 'viewer' is the safe least-privilege landing role.
    op.execute("UPDATE users SET role = 'viewer' WHERE role = 'orphanage_manager'")
    op.drop_constraint("users_role_check", "users", type_="check")
    op.create_check_constraint("users_role_check", "users", f"role IN ({_ROLES_BEFORE})")

    # 2. Drop orphans.orphanage_id (and its index) before the table it
    #    references — its inline FK is dropped with the column.
    op.drop_index("idx_orphans_orphanage_id", table_name="orphans")
    op.drop_column("orphans", "orphanage_id")

    # 3. Drop orphanages — its RLS policy and indexes go with the table.
    op.drop_table("orphanages")
