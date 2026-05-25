"""Bootstrap a development organization, partner, and admin user.

Idempotent: re-running is a no-op if the seed admin already exists.

Usage:
    python -m app.scripts.seed
    # or
    docker compose exec backend python -m app.scripts.seed
"""

import asyncio

from sqlalchemy import select, text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

SEED_ORG_CODE = "DEV"
SEED_PARTNER_CODE = "DEV-PTN"
SEED_ADMIN_EMAIL = "admin@dev.rufaqaa.app"
SEED_ADMIN_PASSWORD = "admin12345"  # dev only


async def seed() -> None:
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
