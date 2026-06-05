"""Orphanage foundation (migration 0011) — model round-trips + role CHECK.

Persistence-layer tests for the schema foundation added in 0011 (no endpoints
exist for orphanages yet). They drive the new ORM mappings against the real
schema:

* an Orphanage persists under an org and an Orphan links to it via
  ``orphanage_id`` (the dar / resident case);
* an Orphan with ``orphanage_id = NULL`` is still valid (the family-home /
  guardian case the column was added alongside);
* a User row with the new ``orphanage_manager`` role is accepted by the
  widened ``users_role_check``.

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. They
reuse the seeded DEV org + DEV-PTN partner and set ``app.current_org_id`` the
same way application code does.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select, text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.user import User


async def _seed_org_and_partner() -> tuple[str, str]:
    """The seeded DEV org + DEV-PTN partner every other integration test uses."""
    async with make_session() as db:
        org_id = await db.scalar(
            text("SELECT id::text FROM organizations WHERE code = 'DEV' LIMIT 1")
        )
        partner_id = await db.scalar(
            text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
        )
    assert org_id is not None
    assert partner_id is not None
    return org_id, partner_id


async def test_orphanage_orphan_link_roundtrip(_engine) -> None:  # noqa: ANN001
    org_id, partner_id = await _seed_org_and_partner()
    suffix = uuid.uuid4().hex[:6]

    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        orphanage = Orphanage(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=uuid.UUID(partner_id),
            code=f"DAR-{suffix.upper()}",
            name_ar="دار الأيتام",
            name_en="Orphanage House",
            country_code="KW",
            city="Kuwait City",
        )
        db.add(orphanage)
        await db.flush()
        orphanage_id = orphanage.id

        orphan = Orphan(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=uuid.UUID(partner_id),
            orphanage_id=orphanage_id,
            code=f"ORF-{suffix.upper()}",
            first_name=f"مقيم-{suffix}",
            family_name="الدار",
            date_of_birth=date(2014, 5, 1),
            gender="M",
            father_name=f"أب-{suffix}",
        )
        db.add(orphan)
        await db.commit()
        orphan_id = orphan.id

    async with make_session() as db:
        fetched_orphan = await db.scalar(select(Orphan).where(Orphan.id == orphan_id))
        assert fetched_orphan is not None
        assert fetched_orphan.orphanage_id == orphanage_id

        fetched_dar = await db.scalar(select(Orphanage).where(Orphanage.id == orphanage_id))
        assert fetched_dar is not None
        assert fetched_dar.code == f"DAR-{suffix.upper()}"
        assert fetched_dar.name_ar == "دار الأيتام"
        assert fetched_dar.organization_id == uuid.UUID(org_id)
        assert fetched_dar.status == "active"  # server default


async def test_orphan_without_orphanage_is_valid(_engine) -> None:  # noqa: ANN001
    """The family-home case: orphanage_id stays NULL and the row is valid."""
    org_id, partner_id = await _seed_org_and_partner()
    suffix = uuid.uuid4().hex[:6]

    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        orphan = Orphan(
            organization_id=uuid.UUID(org_id),
            partner_organization_id=uuid.UUID(partner_id),
            code=f"ORF-{suffix.upper()}",
            first_name=f"بيت-{suffix}",
            family_name="الأسرة",
            date_of_birth=date(2015, 7, 7),
            gender="F",
            father_name=f"أب-{suffix}",
        )
        db.add(orphan)
        await db.commit()
        orphan_id = orphan.id

    async with make_session() as db:
        fetched = await db.scalar(select(Orphan).where(Orphan.id == orphan_id))
        assert fetched is not None
        assert fetched.orphanage_id is None


async def test_user_orphanage_manager_role_accepted(_engine) -> None:  # noqa: ANN001
    """The widened users_role_check accepts the new 'orphanage_manager' value."""
    org_id, _ = await _seed_org_and_partner()
    suffix = uuid.uuid4().hex[:6]

    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        user = User(
            organization_id=uuid.UUID(org_id),
            email=f"dar-manager-{suffix}@dev.rufaqaa.app",
            password_hash=hash_password("manager12345"),
            first_name="Dar",
            last_name="Manager",
            role="orphanage_manager",
        )
        db.add(user)
        await db.commit()
        user_id = user.id

    async with make_session() as db:
        fetched = await db.scalar(select(User).where(User.id == user_id))
        assert fetched is not None
        assert fetched.role == "orphanage_manager"
