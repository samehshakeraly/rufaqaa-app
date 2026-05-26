"""Populate the dev database with realistic-looking demo data.

Idempotent: re-running is a no-op once the marker donor exists. Pass
--force to wipe the demo rows (donors/orphans/sponsorships/payments
created by this script, identified by code prefix) and re-create them.

Usage:
    python -m app.scripts.demo_seed
    python -m app.scripts.demo_seed --force

The base seed (`app.scripts.seed`) must have been run first — this
script reuses the seed organisation and partner.
"""

from __future__ import annotations

import argparse
import asyncio
import random
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import delete, select, text

from app.core.database import make_session
from app.models.donor import Donor
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.payment import Payment
from app.models.sponsorship import Sponsorship

# Marker so the script can be idempotent without polluting the audit
# log with a separate "demo data" entity type.
MARKER_EMAIL = "demo-marker@dev.rufaqaa.app"

# Demo dataset — bilingual where it matters.
ORPHAN_FIXTURES = [
    {
        "first_name": "أحمد",
        "family_name": "العبدالله",
        "father_name": "محمد العبدالله",
        "dob": date(2014, 3, 15),
        "gender": "M",
        "nationality": "PS",
    },
    {
        "first_name": "فاطمة",
        "family_name": "الشمري",
        "father_name": "علي الشمري",
        "dob": date(2016, 7, 22),
        "gender": "F",
        "nationality": "KW",
    },
    {
        "first_name": "يوسف",
        "family_name": "البلوشي",
        "father_name": "حسن البلوشي",
        "dob": date(2013, 11, 8),
        "gender": "M",
        "nationality": "YE",
    },
    {
        "first_name": "مريم",
        "family_name": "الحمد",
        "father_name": "خالد الحمد",
        "dob": date(2017, 1, 30),
        "gender": "F",
        "nationality": "SY",
    },
    {
        "first_name": "إبراهيم",
        "family_name": "السالم",
        "father_name": "عبدالله السالم",
        "dob": date(2012, 6, 18),
        "gender": "M",
        "nationality": "EG",
    },
    {
        "first_name": "زينب",
        "family_name": "المحمود",
        "father_name": "أنس المحمود",
        "dob": date(2015, 9, 5),
        "gender": "F",
        "nationality": "SD",
    },
]

DONOR_FIXTURES = [
    {"full_name": "محسن خيّر", "email": "demo-donor-1@example.com", "currency": "KWD"},
    {"full_name": "أم اليتيم", "email": "demo-donor-2@example.com", "currency": "SAR"},
    {"full_name": "Abdullah Al-Mutairi", "email": "demo-donor-3@example.com", "currency": "USD"},
    {"full_name": "Fatima Al-Zahra", "email": "demo-donor-4@example.com", "currency": "AED"},
    {"full_name": "كافل مجهول", "email": "demo-donor-5@example.com", "currency": "KWD"},
]


def _code(prefix: str) -> str:
    """Demo-tagged code so we can later identify and wipe."""
    return f"{prefix}-DEMO{uuid4().hex[:4].upper()}"


def _next_monthly(start: date) -> date:
    year, month = start.year, start.month + 1
    if month > 12:
        month, year = 1, year + 1
    return date(year, month, min(start.day, 28))


async def _seed_org_and_partner() -> tuple[UUID, UUID]:
    async with make_session() as db:
        org = await db.scalar(select(Organization).where(Organization.code == "DEV"))
        if org is None:
            raise SystemExit("Run `python -m app.scripts.seed` first.")
        row = (
            await db.execute(
                text(
                    "SELECT id FROM partner_organizations "
                    "WHERE code = 'DEV-PTN' AND organization_id = :oid LIMIT 1"
                ),
                {"oid": str(org.id)},
            )
        ).first()
        if row is None:
            raise SystemExit("Seed partner missing — run base seed first.")
        return org.id, row[0]


async def _already_seeded() -> bool:
    async with make_session() as db:
        return (await db.scalar(select(Donor).where(Donor.email == MARKER_EMAIL))) is not None


async def _wipe_demo() -> None:
    """Delete every row created by previous runs of this script.
    Identified by the DEMO sentinel in the code column."""
    async with make_session() as db:
        # Payments → sponsorships → orphans → donors (FK order)
        await db.execute(delete(Payment).where(Payment.code.like("PAY-DEMO%")))
        await db.execute(delete(Sponsorship).where(Sponsorship.code.like("KAF-DEMO%")))
        await db.execute(delete(Orphan).where(Orphan.code.like("ORF-DEMO%")))
        await db.execute(delete(Donor).where(Donor.code.like("DON-DEMO%")))
        await db.execute(delete(Donor).where(Donor.email == MARKER_EMAIL))
        await db.commit()


async def _seed_demo() -> dict[str, int]:
    org_id, partner_id = await _seed_org_and_partner()
    rng = random.Random(42)  # deterministic so screenshots stay stable
    counts = {"orphans": 0, "donors": 0, "sponsorships": 0, "payments": 0}

    async with make_session() as db:
        # Marker — sentinel donor for the idempotency check
        db.add(
            Donor(
                organization_id=org_id,
                code=_code("DON"),
                full_name="Demo Marker",
                email=MARKER_EMAIL,
                preferred_currency="KWD",
                status="active",
            )
        )

        orphans: list[Orphan] = []
        statuses = [
            "available",
            "available",
            "sponsored",
            "sponsored",
            "pending_review",
            "approved",
        ]
        for fixture, status in zip(ORPHAN_FIXTURES, statuses, strict=True):
            o = Orphan(
                organization_id=org_id,
                partner_organization_id=partner_id,
                code=_code("ORF"),
                first_name=fixture["first_name"],
                family_name=fixture["family_name"],
                father_name=fixture["father_name"],
                date_of_birth=fixture["dob"],
                gender=fixture["gender"],
                nationality=fixture["nationality"],
                case_status=status,
                is_sponsored=status == "sponsored",
                current_balance=Decimal("0"),
            )
            db.add(o)
            orphans.append(o)
        counts["orphans"] = len(orphans)

        donors: list[Donor] = []
        for fixture in DONOR_FIXTURES:
            d = Donor(
                organization_id=org_id,
                code=_code("DON"),
                full_name=fixture["full_name"],
                email=fixture["email"],
                preferred_currency=fixture["currency"],
                country_of_residence="KW",
                status="active",
            )
            db.add(d)
            donors.append(d)
        counts["donors"] = len(donors)

        await db.flush()  # IDs are now populated

        sponsorships: list[Sponsorship] = []
        # Pair the first 4 donors with the 4 'available'/'sponsored' orphans.
        for donor, orphan in zip(donors[:4], orphans[:4], strict=True):
            amount = Decimal(rng.choice(["15.00", "20.00", "25.00", "30.00"]))
            sp = Sponsorship(
                organization_id=org_id,
                code=_code("KAF"),
                donor_id=donor.id,
                orphan_id=orphan.id,
                monthly_amount=amount,
                currency=donor.preferred_currency or "KWD",
                start_date=date.today() - timedelta(days=rng.randint(30, 365)),
                payment_frequency="monthly",
                next_payment_date=_next_monthly(date.today()),
                status="active",
                total_paid=Decimal("0"),
                payments_count=0,
            )
            db.add(sp)
            sponsorships.append(sp)
        counts["sponsorships"] = len(sponsorships)

        await db.flush()

        # 2 historical payments per active sponsorship.
        now = datetime.now(UTC)
        for sp in sponsorships:
            for k in range(2):
                completed_at = now - timedelta(days=30 * (k + 1))
                pay = Payment(
                    organization_id=org_id,
                    code=_code("PAY"),
                    donor_id=sp.donor_id,
                    sponsorship_id=sp.id,
                    orphan_id=sp.orphan_id,
                    amount=sp.monthly_amount,
                    currency=sp.currency,
                    payment_method=rng.choice(["knet", "credit_card", "bank_transfer"]),
                    status="completed",
                    completed_at=completed_at,
                )
                db.add(pay)
                sp.total_paid = (sp.total_paid or Decimal("0")) + sp.monthly_amount
                sp.payments_count = (sp.payments_count or 0) + 1
                sp.last_payment_date = completed_at.date()
                sp.last_payment_amount = sp.monthly_amount
                counts["payments"] += 1

        await db.commit()

    return counts


async def main(force: bool) -> None:
    if await _already_seeded():
        if not force:
            print(
                f"✔ demo data already present (marker = {MARKER_EMAIL!r}); use --force to recreate."
            )
            return
        print("→ --force: wiping prior demo rows")
        await _wipe_demo()

    counts = await _seed_demo()
    print(
        f"✔ seeded demo data: "
        f"{counts['orphans']} orphans, "
        f"{counts['donors']} donors, "
        f"{counts['sponsorships']} sponsorships, "
        f"{counts['payments']} payments"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="wipe and recreate")
    args = parser.parse_args()
    asyncio.run(main(args.force))
