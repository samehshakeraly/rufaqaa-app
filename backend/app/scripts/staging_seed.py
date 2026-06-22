"""Seed a minimal, obviously-fake demo dataset for the staging deployment.

Operational sample data for the public demo / staging environment (see
``DEPLOY_DEMO.md``) — distinct from the dev :mod:`app.scripts.demo_seed`,
which fills *every* screen and reuses the base :mod:`app.scripts.seed`
organisation. This script is self-contained: it creates its **own** demo
organisations so a fresh staging database has something to show.

What it inserts — all clearly fake, every row carrying an explicit
``organization_id``:

* 2 demo organisations, each with 1 partner organisation and 1 ``org_admin``
  login (so the dashboard renders — RLS scopes every screen to the signed-in
  user's organisation);
* 5 orphans — ``national_id`` is written **only** through the field-encryption
  path (:func:`app.core.crypto.encrypt_field` → the ``national_id_encrypted``
  BYTEA column); raw ciphertext is never inserted;
* 3 donors;
* 2 sponsorships (donor ↔ orphan, within the same organisation);
* sample document + media rows pointing at placeholder objects.

Idempotent: re-running is a no-op once the demo organisations exist. Pass
``--force`` to delete the demo rows (everything scoped to the demo
organisations, in FK order) and recreate them.

This script does **not** touch the reference country / currency seed shipped
in the canonical schema — those rows are loaded by migration ``0001`` and are
a prerequisite (run ``alembic upgrade head`` first).

Usage:
    python -m app.scripts.staging_seed
    python -m app.scripts.staging_seed --force
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import encrypt_field, national_id_blind_index
from app.core.database import make_session
from app.core.security import hash_password
from app.models.document import Document
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.services.orphans import recompute_profile_completion, stamp_available_since
from app.utils.codes import generate_code

# ── Demo identity ────────────────────────────────────────────────────────
# The fixed organisation codes double as the idempotency marker: the entire
# dataset is scoped to these two orgs, so "demo data already exists" reduces
# to "org A exists", and ``--force`` wipes every row carrying their
# organization_id. Country / currency codes below are all present in the
# canonical reference seed (migration 0001), so the FKs resolve.
DEMO_ORG_A_CODE = "DEMO-ORG-A"
DEMO_ORG_B_CODE = "DEMO-ORG-B"

# Clearly-fake shared login password for the two demo org admins. Demo only —
# documented in DEPLOY_DEMO.md and meant for a throwaway staging host.
DEMO_ADMIN_PASSWORD = "demo-admin-12345"  # demo only

# Per-org fixtures. Each org gets one partner organisation (orphans require a
# partner_organization_id) and one org_admin login.
DEMO_ORGS: list[dict[str, str]] = [
    {
        "code": DEMO_ORG_A_CODE,
        "name_ar": "منظمة رفقاء التجريبية (أ)",
        "name_en": "Rufaqaa Demo Organization A",
        "country_code": "KW",
        "partner_code": "DEMO-PTN-A",
        "partner_name_ar": "شريك رفقاء التجريبي (أ)",
        "partner_name_en": "Rufaqaa Demo Partner A",
        "partner_country": "PS",
        "admin_email": "demo-admin-a@demo.rufaqaa.app",
    },
    {
        "code": DEMO_ORG_B_CODE,
        "name_ar": "منظمة رفقاء التجريبية (ب)",
        "name_en": "Rufaqaa Demo Organization B",
        "country_code": "SA",
        "partner_code": "DEMO-PTN-B",
        "partner_name_ar": "شريك رفقاء التجريبي (ب)",
        "partner_name_en": "Rufaqaa Demo Partner B",
        "partner_country": "YE",
        "admin_email": "demo-admin-b@demo.rufaqaa.app",
    },
]

# Document types cycled across the demo orphans (all valid per the schema's
# document_type CHECK).
_DOC_TYPES = [
    "birth_certificate",
    "death_certificate",
    "school_certificate",
    "medical_report",
    "family_record",
]

# Placeholder object URLs — these rows reference images/files that do not need
# to exist in object storage; they exercise the media/document surfaces only.
_PHOTO_URL = "https://placehold.co/400x400?text=Demo+Orphan+Photo"
_DOC_URL = "https://placehold.co/600x800?text=Demo+Document"


def _zero_counts() -> dict[str, int]:
    return {
        "organizations": 0,
        "partners": 0,
        "users": 0,
        "orphans": 0,
        "donors": 0,
        "sponsorships": 0,
        "documents": 0,
        "media": 0,
    }


async def _already_seeded() -> bool:
    async with make_session() as db:
        found = await db.scalar(select(Organization.id).where(Organization.code == DEMO_ORG_A_CODE))
        return found is not None


async def _wipe() -> None:
    """Delete every row created by previous runs, scoped to the demo orgs.

    Deletes children before parents (the schema does not cascade
    sponsorships/donors from organisations), so the whole bundle comes out
    cleanly. ``media`` has no ORM model, so it is removed with raw SQL.
    """
    async with make_session() as db:
        org_ids = list(
            (
                await db.scalars(
                    select(Organization.id).where(
                        Organization.code.in_([DEMO_ORG_A_CODE, DEMO_ORG_B_CODE])
                    )
                )
            ).all()
        )
        if not org_ids:
            return
        id_strs = [str(x) for x in org_ids]

        await db.execute(delete(Sponsorship).where(Sponsorship.organization_id.in_(org_ids)))
        await db.execute(
            text("DELETE FROM media WHERE organization_id::text = ANY(:ids)"),
            {"ids": id_strs},
        )
        await db.execute(delete(Document).where(Document.organization_id.in_(org_ids)))
        await db.execute(delete(Orphan).where(Orphan.organization_id.in_(org_ids)))
        await db.execute(delete(Donor).where(Donor.organization_id.in_(org_ids)))
        await db.execute(delete(User).where(User.organization_id.in_(org_ids)))
        await db.execute(
            delete(PartnerOrganization).where(PartnerOrganization.organization_id.in_(org_ids))
        )
        await db.execute(delete(Organization).where(Organization.id.in_(org_ids)))
        await db.commit()


async def _seed_org_bundle(
    db: AsyncSession,
    *,
    spec: dict[str, str],
    n_orphans: int,
    n_donors: int,
    n_sponsorships: int,
    counts: dict[str, int],
) -> None:
    """Insert one org + its partner, admin, orphans, donors, sponsorships,
    documents and media. Flushes (but does not commit) so the caller can wrap
    several bundles in a single transaction."""
    suffix = spec["code"][-1]  # "A" / "B" — a human-readable demo tag

    org = Organization(
        code=spec["code"],
        name_ar=spec["name_ar"],
        name_en=spec["name_en"],
        org_type="standalone",
        deployment_mode="self_hosted",
        country_code=spec["country_code"],
        default_currency="KWD",
    )
    db.add(org)
    await db.flush()  # org.id
    counts["organizations"] += 1

    admin = User(
        organization_id=org.id,
        email=spec["admin_email"],
        password_hash=hash_password(DEMO_ADMIN_PASSWORD),
        first_name="Demo",
        last_name=f"Admin {suffix}",
        role="org_admin",
        status="active",
    )
    db.add(admin)

    partner = PartnerOrganization(
        organization_id=org.id,
        code=spec["partner_code"],
        name_ar=spec["partner_name_ar"],
        name_en=spec["partner_name_en"],
        country_code=spec["partner_country"],
        status="active",
    )
    db.add(partner)
    await db.flush()  # admin.id, partner.id
    counts["users"] += 1
    counts["partners"] += 1

    orphans: list[Orphan] = []
    for i in range(n_orphans):
        gender = "M" if i % 2 == 0 else "F"
        orphan = Orphan(
            organization_id=org.id,
            partner_organization_id=partner.id,
            code=generate_code("ORF"),
            first_name=f"يتيم تجريبي {i + 1}",
            family_name=f"التجريبي {suffix}",
            full_name_en=f"Demo Orphan {suffix}{i + 1}",
            father_name=f"والد تجريبي {suffix}{i + 1}",
            date_of_birth=date(2010 + i, 1 + i, 5 + i),
            gender=gender,
            nationality=spec["partner_country"],
            # national_id is written ONLY through the field-encryption path
            # (encrypt_field → national_id_encrypted BYTEA). The value is a
            # clearly-fake string; raw ciphertext is never inserted directly.
            # The deterministic blind index is stored alongside it (same as the
            # real create path) so demo rows match the ciphertext↔index invariant.
            national_id_encrypted=encrypt_field(f"DEMO-NID-{suffix}-{i + 1}"),
            national_id_blind_index=national_id_blind_index(f"DEMO-NID-{suffix}-{i + 1}"),
            education_stage="primary",
            school_name="مدرسة تجريبية",
            quran_juz_memorized=i + 1,
            health_status="good",
            aspiration="طموح تجريبي",
            tags=["تجريبي", "demo"],
            case_status="available",
            balance_currency="KWD",
            created_by=admin.id,
        )
        stamp_available_since(orphan)
        recompute_profile_completion(orphan)
        db.add(orphan)
        orphans.append(orphan)
    counts["orphans"] += n_orphans

    donors: list[Donor] = []
    for i in range(n_donors):
        donor = Donor(
            organization_id=org.id,
            code=generate_code("DON"),
            full_name=f"متبرع تجريبي {suffix}{i + 1}",
            full_name_en=f"Demo Donor {suffix}{i + 1}",
            email=f"demo-donor-{suffix.lower()}{i + 1}@demo.rufaqaa.app",
            preferred_currency="KWD",
            country_of_residence=spec["country_code"],
            status="active",
        )
        db.add(donor)
        donors.append(donor)
    counts["donors"] += n_donors

    await db.flush()  # orphan.id, donor.id

    # Sponsorships pair donor[i] ↔ orphan[i] inside this same organisation.
    for i in range(n_sponsorships):
        donor = donors[i]
        orphan = orphans[i]
        db.add(
            Sponsorship(
                organization_id=org.id,
                code=generate_code("KAF"),
                donor_id=donor.id,
                orphan_id=orphan.id,
                monthly_amount=Decimal("20.00"),
                currency="KWD",
                start_date=date.today() - timedelta(days=90),
                payment_frequency="monthly",
                payment_method="knet",
                next_payment_date=date.today() + timedelta(days=30),
                status="active",
                total_paid=Decimal("0"),
                payments_count=0,
                months_overdue=0,
                created_by=admin.id,
            )
        )
        orphan.is_sponsored = True
        orphan.case_status = "sponsored"
        donor.total_sponsorships = (donor.total_sponsorships or 0) + 1
        donor.active_sponsorships = (donor.active_sponsorships or 0) + 1
    counts["sponsorships"] += n_sponsorships

    # One placeholder document per orphan.
    for i, orphan in enumerate(orphans):
        dtype = _DOC_TYPES[i % len(_DOC_TYPES)]
        db.add(
            Document(
                organization_id=org.id,
                orphan_id=orphan.id,
                document_type=dtype,
                title=f"{dtype} (تجريبي) — {orphan.first_name}",
                file_url=_DOC_URL,
                file_name=f"{dtype}_{orphan.code}.pdf",
                file_mime_type="application/pdf",
                file_size_bytes=123_456,
                storage_provider="local",
                verification_status="pending",
                is_encrypted=False,
                uploaded_by=admin.id,
            )
        )
    counts["documents"] += len(orphans)

    # One placeholder media photo per orphan (no ORM model → raw INSERT).
    now = datetime.now(UTC)
    for orphan in orphans:
        await db.execute(
            text(
                """
                INSERT INTO media
                    (id, organization_id, orphan_id, media_type,
                     title, file_url, file_size_bytes,
                     moderation_status, visibility, uploaded_by, created_at)
                VALUES
                    (:id, :org, :orphan, 'photo',
                     :title, :url, :size,
                     'approved', 'donor_only', :uploader, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "org": str(org.id),
                "orphan": str(orphan.id),
                "title": f"صورة تجريبية — {orphan.first_name}",
                "url": _PHOTO_URL,
                "size": 234_567,
                "uploader": str(admin.id),
                "now": now,
            },
        )
    counts["media"] += len(orphans)


async def main(force: bool) -> None:
    if await _already_seeded():
        if not force:
            print(
                f"✔ demo data already present (org {DEMO_ORG_A_CODE!r}); use --force to recreate."
            )
            return
        print("→ --force: wiping prior demo rows")
        await _wipe()

    counts = _zero_counts()
    async with make_session() as db:
        # Org A is the richer tenant (3 orphans / 2 donors / 2 sponsorships);
        # Org B is a second tenant proving isolation (2 orphans / 1 donor).
        await _seed_org_bundle(
            db, spec=DEMO_ORGS[0], n_orphans=3, n_donors=2, n_sponsorships=2, counts=counts
        )
        await _seed_org_bundle(
            db, spec=DEMO_ORGS[1], n_orphans=2, n_donors=1, n_sponsorships=0, counts=counts
        )
        await db.commit()

    print(
        "✔ seeded staging demo data: "
        f"{counts['organizations']} organizations, "
        f"{counts['partners']} partners, "
        f"{counts['users']} admins, "
        f"{counts['orphans']} orphans, "
        f"{counts['donors']} donors, "
        f"{counts['sponsorships']} sponsorships, "
        f"{counts['documents']} documents, "
        f"{counts['media']} media"
    )
    print("\nDemo logins (org_admin):")
    for spec in DEMO_ORGS:
        print(f"  {spec['admin_email']} / {DEMO_ADMIN_PASSWORD}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="wipe and recreate")
    args = parser.parse_args()
    asyncio.run(main(args.force))
