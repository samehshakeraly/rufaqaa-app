"""Bootstrap a development organization, partner, and admin user.

Idempotent: re-running is a no-op if the seed admin already exists.

Usage:
    python -m app.scripts.seed
    # or
    docker compose exec backend python -m app.scripts.seed
"""

import asyncio

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

SEED_ORG_CODE = "DEV"
SEED_PLATFORM_ORG_CODE = "PLATFORM"
SEED_PARTNER_CODE = "DEV-PTN"
SEED_ADMIN_EMAIL = "admin@dev.rufaqaa.app"
SEED_ADMIN_PASSWORD = "admin12345"  # dev only


async def _ensure_platform_org(db: AsyncSession) -> Organization:
    """The PLATFORM org owns every donor created via public signup.

    They don't belong to any partner / branch — they're 'just donors'
    on the platform. The org row is real (so RLS works, FKs land), but
    operationally inert: no orphans, no staff, no partners attached."""
    existing = await db.scalar(
        select(Organization).where(Organization.code == SEED_PLATFORM_ORG_CODE)
    )
    if existing is not None:
        return existing
    org = Organization(
        code=SEED_PLATFORM_ORG_CODE,
        name_ar="منصة رفقاء",
        name_en="Rufaqaa Platform",
        org_type="standalone",
        deployment_mode="self_hosted",
        country_code="KW",
    )
    db.add(org)
    await db.flush()
    print(f"✔ created platform org: {org.code} (id={org.id})")
    return org


async def seed() -> None:
    async with make_session() as db:
        # Always make sure the platform org exists — every public donor
        # signup needs it whether or not the dev admin has been seeded.
        await _ensure_platform_org(db)
        await db.commit()

    async with make_session() as db:
        existing = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        if existing:
            print(f"✔ seed admin already exists: {SEED_ADMIN_EMAIL} (id={existing.id})")
            return

        org = await db.scalar(select(Organization).where(Organization.code == SEED_ORG_CODE))
        if org is None:
            org = Organization(
                code=SEED_ORG_CODE,
                name_ar="منظمة التطوير",
                name_en="Development Organization",
                org_type="standalone",
                deployment_mode="self_hosted",
                country_code="KW",
            )
            db.add(org)
            await db.flush()
            print(f"✔ created organization: {org.code} (id={org.id})")
        else:
            print(f"✔ organization already exists: {org.code} (id={org.id})")

        await db.execute(
            text(
                """
                INSERT INTO partner_organizations
                    (organization_id, code, name_ar, country_code, status)
                VALUES
                    (:org_id, :code, :name_ar, 'KW', 'active')
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"org_id": str(org.id), "code": SEED_PARTNER_CODE, "name_ar": "شريك التطوير"},
        )

        admin = User(
            organization_id=org.id,
            email=SEED_ADMIN_EMAIL,
            password_hash=hash_password(SEED_ADMIN_PASSWORD),
            first_name="Dev",
            last_name="Admin",
            role="org_admin",
            status="active",
        )
        db.add(admin)
        await db.commit()

        print(f"✔ created admin: {admin.email}")
        print(f"  password: {SEED_ADMIN_PASSWORD}")
        print(f"  org_id:   {org.id}")


if __name__ == "__main__":
    asyncio.run(seed())
