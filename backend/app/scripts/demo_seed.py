"""Populate the dev database with realistic-looking demo data.

Seeds **every** major section of the app so no screen renders an empty
table: partners, marketing channels, families, guardians, orphans,
donors, sponsorships, payments, orphan reports, documents, media,
bank transfers and messages.

Idempotent: re-running is a no-op once the marker donor exists. Pass
--force to wipe the demo rows (everything created by this script,
identified by a ``-DEMO`` code prefix or a demo marker) and re-create
them.

Usage:
    python -m app.scripts.demo_seed
    python -m app.scripts.demo_seed --force

The base seed (`app.scripts.seed`) must have been run first — this
script reuses the seed organisation and admin user.
"""

from __future__ import annotations

import argparse
import asyncio
import random
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, select, text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.bank_transfer import BankTransfer
from app.models.document import Document
from app.models.donor import Donor
from app.models.family import Family, Guardian
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.orphanage import Orphanage
from app.models.partner import MarketingChannel, PartnerOrganization
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.services.orphans import recompute_profile_completion

# Marker so the script can be idempotent without polluting the audit
# log with a separate "demo data" entity type.
MARKER_EMAIL = "demo-marker@dev.rufaqaa.app"

SEED_ADMIN_EMAIL = "admin@dev.rufaqaa.app"

# Marker baked into marketing-channel names so they can be wiped (the
# marketing_channels table has no `code` column).
CHANNEL_MARKER = "(DEMO)"

# ── Portal test accounts ────────────────────────────────────────────────
# Linked to a guardian / orphan so the respective portals are testable.
GUARDIAN_USERS = [
    {"email": "guardian1@dev.rufaqaa.app", "password": "guardian12345"},
    {"email": "guardian2@dev.rufaqaa.app", "password": "guardian12345"},
]
ORPHAN_USER = {"email": "orphan1@dev.rufaqaa.app", "password": "orphan12345"}
# Marketing manager — org-scoped, so it can reach every demo marketing
# channel (MM-01 / MM-03) without a per-channel ownership link.
MARKETING_USER = {"email": "marketing1@dev.rufaqaa.app", "password": "marketing12345"}
# Orphanage manager — linked to the demo dar below (orphanages.manager_user_id),
# the foundation for the forthcoming manager portal.
ORPHANAGE_MANAGER_USER = {"email": "manager1@dev.rufaqaa.app", "password": "manager12345"}
# Back-office roles that previously had no demo login. Like every account here
# they link to the org only via organization_id (the User model has no partner
# association), so the standard _make_user helper below covers them as-is.
SUPER_ADMIN_USER = {"email": "superadmin@dev.rufaqaa.app", "password": "superadmin12345"}
PARTNER_MANAGER_USER = {"email": "partner1@dev.rufaqaa.app", "password": "partner12345"}
PARTNER_STAFF_USER = {"email": "staff1@dev.rufaqaa.app", "password": "staff12345"}
# Dedicated field-researcher (intake) login for the Kenya جهة — a clean,
# single-purpose account for the orphan-intake demo. Same role + جهة as
# PARTNER_STAFF_USER, just a clearer email/name for that scenario.
KENYA_INTAKE_USER = {"email": "kenya-intake@dev.rufaqaa.app", "password": "kenya12345"}
FINANCE_USER = {"email": "finance1@dev.rufaqaa.app", "password": "finance12345"}
VIEWER_USER = {"email": "viewer1@dev.rufaqaa.app", "password": "viewer12345"}
# Two donors get login accounts so donor↔guardian messages have a
# resolvable from/to user (messages.from_user_id is NOT NULL).
DONOR_USERS = [
    {"email": "donor1@dev.rufaqaa.app", "password": "donor12345"},
    {"email": "donor2@dev.rufaqaa.app", "password": "donor12345"},
]

# All demo user emails — used to wipe them on --force.
DEMO_USER_EMAILS = [
    *(u["email"] for u in GUARDIAN_USERS),
    ORPHAN_USER["email"],
    MARKETING_USER["email"],
    ORPHANAGE_MANAGER_USER["email"],
    SUPER_ADMIN_USER["email"],
    PARTNER_MANAGER_USER["email"],
    PARTNER_STAFF_USER["email"],
    KENYA_INTAKE_USER["email"],
    FINANCE_USER["email"],
    VIEWER_USER["email"],
    *(u["email"] for u in DONOR_USERS),
]

# ── Fixtures ─────────────────────────────────────────────────────────────
PARTNER_FIXTURES: list[dict[str, str]] = [
    {
        "name_ar": "جمعية الإحسان الفلسطينية",
        "name_en": "Al-Ihsan Palestine Charity",
        "country_code": "PS",
        "contact_person": "محمود العسلي",
        "contact_email": "info@ihsan-ps.example",
        "contact_phone": "+970591234567",
    },
    {
        "name_ar": "مؤسسة الرحمة المصرية",
        "name_en": "Al-Rahma Egypt Foundation",
        "country_code": "EG",
        "contact_person": "أحمد فؤاد",
        "contact_email": "info@rahma-eg.example",
        "contact_phone": "+201001234567",
    },
    {
        "name_ar": "جمعية الخير اليمنية",
        "name_en": "Al-Khair Yemen Society",
        "country_code": "YE",
        "contact_person": "علي المقطري",
        "contact_email": "info@khair-ye.example",
        "contact_phone": "+967711234567",
    },
    {
        "name_ar": "العون المباشر كينيا",
        "name_en": "Direct Aid Kenya",
        "country_code": "KE",
        "contact_person": "جمال عبدالله",
        "contact_email": "info@directaid-ke.example",
        "contact_phone": "+254712345678",
    },
]

CHANNEL_FIXTURES: list[dict[str, Any]] = [
    {
        "name_ar": "الموقع الإلكتروني",
        "name_en": f"Website {CHANNEL_MARKER}",
        "channel_type": "website",
        "annual_goal_count": 120,
        "annual_goal_amount": Decimal("72000.00"),
    },
    {
        "name_ar": "وسائل التواصل الاجتماعي",
        "name_en": f"Social Media {CHANNEL_MARKER}",
        "channel_type": "social_media",
        "annual_goal_count": 200,
        "annual_goal_amount": Decimal("120000.00"),
    },
    {
        "name_ar": "الفرع الرئيسي",
        "name_en": f"Main Branch {CHANNEL_MARKER}",
        "channel_type": "branch",
        "annual_goal_count": 80,
        "annual_goal_amount": Decimal("48000.00"),
    },
    {
        "name_ar": "لجنة الزكاة",
        "name_en": f"Zakat Committee {CHANNEL_MARKER}",
        "channel_type": "committee",
        "annual_goal_count": 150,
        "annual_goal_amount": Decimal("90000.00"),
    },
]

FAMILY_FIXTURES: list[dict[str, Any]] = [
    {
        "family_name": "العبدالله",
        "deceased_father": "محمد العبدالله",
        "city": "غزة",
        "housing": "rented",
        "income": "180.00",
    },
    {
        "family_name": "الشمري",
        "deceased_father": "علي الشمري",
        "city": "القاهرة",
        "housing": "owned",
        "income": "220.00",
    },
    {
        "family_name": "البلوشي",
        "deceased_father": "حسن البلوشي",
        "city": "صنعاء",
        "housing": "donated",
        "income": "90.00",
    },
    {
        "family_name": "الحمد",
        "deceased_father": "خالد الحمد",
        "city": "خان يونس",
        "housing": "rented",
        "income": "150.00",
    },
    {
        "family_name": "السالم",
        "deceased_father": "عبدالله السالم",
        "city": "الإسكندرية",
        "housing": "rented",
        "income": "200.00",
    },
    {
        "family_name": "المحمود",
        "deceased_father": "أنس المحمود",
        "city": "تعز",
        "housing": "homeless",
        "income": "60.00",
    },
    {
        "family_name": "الخطيب",
        "deceased_father": "يوسف الخطيب",
        "city": "رفح",
        "housing": "donated",
        "income": "120.00",
    },
    {
        "family_name": "النجار",
        "deceased_father": "إبراهيم النجار",
        "city": "الجيزة",
        "housing": "owned",
        "income": "240.00",
    },
]

# Mostly "mother" / "grandfather" per spec.
GUARDIAN_FIXTURES: list[dict[str, Any]] = [
    {"full_name": "فاطمة العبدالله", "relation": "mother", "gender": "F"},
    {"full_name": "عبدالله الشمري", "relation": "grandfather", "gender": "M"},
    {"full_name": "خديجة البلوشي", "relation": "mother", "gender": "F"},
    {"full_name": "عائشة الحمد", "relation": "mother", "gender": "F"},
    {"full_name": "يوسف السالم", "relation": "grandfather", "gender": "M"},
    {"full_name": "آمنة المحمود", "relation": "mother", "gender": "F"},
    {"full_name": "حسن الخطيب", "relation": "grandfather", "gender": "M"},
    {"full_name": "زينب النجار", "relation": "mother", "gender": "F"},
]

MALE_NAMES = [
    "أحمد",
    "محمد",
    "يوسف",
    "إبراهيم",
    "عبدالله",
    "حسن",
    "عمر",
    "خالد",
    "علي",
    "عبدالرحمن",
]
FEMALE_NAMES = ["فاطمة", "عائشة", "خديجة", "مريم", "زينب", "سارة", "نور", "رقية", "آمنة", "هدى"]

DONOR_FIXTURES: list[dict[str, str]] = [
    {"full_name": "محسن خيّر", "email": "demo-donor-1@example.com", "currency": "KWD"},
    {"full_name": "أم اليتيم", "email": "demo-donor-2@example.com", "currency": "SAR"},
    {"full_name": "Abdullah Al-Mutairi", "email": "demo-donor-3@example.com", "currency": "USD"},
    {"full_name": "Fatima Al-Zahra", "email": "demo-donor-4@example.com", "currency": "AED"},
    {"full_name": "كافل مجهول", "email": "demo-donor-5@example.com", "currency": "KWD"},
    {"full_name": "سالم الفهد", "email": "demo-donor-6@example.com", "currency": "KWD"},
    {"full_name": "نورة العتيبي", "email": "demo-donor-7@example.com", "currency": "SAR"},
    {"full_name": "Yousef Rahman", "email": "demo-donor-8@example.com", "currency": "USD"},
    {"full_name": "مريم الصباح", "email": "demo-donor-9@example.com", "currency": "KWD"},
    {"full_name": "خالد الدوسري", "email": "demo-donor-10@example.com", "currency": "SAR"},
    {"full_name": "Layla Hassan", "email": "demo-donor-11@example.com", "currency": "AED"},
    {"full_name": "عبدالعزيز القحطاني", "email": "demo-donor-12@example.com", "currency": "KWD"},
    {"full_name": "هند المطيري", "email": "demo-donor-13@example.com", "currency": "KWD"},
    {"full_name": "Omar Khalil", "email": "demo-donor-14@example.com", "currency": "USD"},
    {"full_name": "صالح العنزي", "email": "demo-donor-15@example.com", "currency": "SAR"},
]

# Realistic Arabic donor↔guardian exchanges, with a moderation mix.
MESSAGE_FIXTURES: list[dict[str, str]] = [
    {"content": "السلام عليكم، كيف حال ابني في المدرسة هذا الفصل؟", "status": "approved"},
    {"content": "وعليكم السلام ورحمة الله، الحمد لله بخير ويتفوق في دراسته.", "status": "approved"},
    {
        "content": "جزاكم الله خيراً على كفالتكم الكريمة، نسأل الله أن يبارك فيكم.",
        "status": "approved",
    },
    {"content": "هل يمكن إرسال صور حديثة للطفل لو تكرمتم؟", "status": "pending"},
    {"content": "تم استلام كفالة هذا الشهر، شكراً جزيلاً لكرمكم.", "status": "approved"},
    {"content": "ندعو لكم ولأهلكم بالخير والصحة دائماً.", "status": "pending"},
    {"content": "الطفل بحاجة إلى ملابس شتوية مع اقتراب البرد.", "status": "approved"},
    {"content": "رقم هاتفي الشخصي هو ... تواصلوا معي مباشرة خارج المنصة.", "status": "rejected"},
]


def _code(prefix: str) -> str:
    """Demo-tagged code so we can later identify and wipe."""
    return f"{prefix}-DEMO{uuid4().hex[:4].upper()}"


def _next_monthly(start: date) -> date:
    year, month = start.year, start.month + 1
    if month > 12:
        month, year = 1, year + 1
    return date(year, month, min(start.day, 28))


def _month_window(months_ago: int) -> tuple[date, date]:
    """First and last day of the month `months_ago` months before today."""
    today = date.today()
    year, month = today.year, today.month - months_ago
    while month <= 0:
        month += 12
        year -= 1
    start = date(year, month, 1)
    nm_year, nm_month = (year + 1, 1) if month == 12 else (year, month + 1)
    end = date(nm_year, nm_month, 1) - timedelta(days=1)
    return start, end


async def _seed_org() -> tuple[UUID, UUID]:
    """Return (organization_id, admin_user_id) from the base seed."""
    async with make_session() as db:
        org = await db.scalar(select(Organization).where(Organization.code == "DEV"))
        if org is None:
            raise SystemExit("Run `python -m app.scripts.seed` first.")
        admin = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        if admin is None:
            raise SystemExit("Seed admin missing — run base seed first.")
        return org.id, admin.id


async def _already_seeded() -> bool:
    async with make_session() as db:
        return (await db.scalar(select(Donor).where(Donor.email == MARKER_EMAIL))) is not None


async def _wipe_demo() -> None:
    """Delete every row created by previous runs of this script, in FK
    order (children first). Demo rows are identified by a ``-DEMO`` code
    prefix, a demo marker in the name, or a link to a demo entity."""
    orphan_ids = text("SELECT id FROM orphans WHERE code LIKE 'ORF-DEMO%'")
    family_ids = text("SELECT id FROM families WHERE code LIKE 'FAM-DEMO%'")
    transfer_ids = text("SELECT id FROM bank_transfers WHERE code LIKE 'BNK-DEMO%'")
    guardian_by_family = text(
        "SELECT id FROM guardians WHERE family_id IN "
        "(SELECT id FROM families WHERE code LIKE 'FAM-DEMO%')"
    )

    async with make_session() as db:
        # 1. Messages (reference demo users + orphans)
        await db.execute(
            text(
                "DELETE FROM messages WHERE "
                "related_orphan_id IN (SELECT id FROM orphans WHERE code LIKE 'ORF-DEMO%') "
                "OR from_user_id IN (SELECT id FROM users WHERE email = ANY(:emails)) "
                "OR to_user_id IN (SELECT id FROM users WHERE email = ANY(:emails))"
            ),
            {"emails": DEMO_USER_EMAILS},
        )
        # 2. Bank-transfer items (also cascade-deleted with the transfer)
        await db.execute(
            text(f"DELETE FROM bank_transfer_items WHERE transfer_id IN ({transfer_ids.text})")
        )
        # 3. Bank transfers
        await db.execute(delete(BankTransfer).where(BankTransfer.code.like("BNK-DEMO%")))
        # 4. Media (no code column → scope by demo orphan)
        await db.execute(text(f"DELETE FROM media WHERE orphan_id IN ({orphan_ids.text})"))
        # 5. Orphan reports
        await db.execute(
            delete(OrphanReport).where(
                OrphanReport.orphan_id.in_(select(Orphan.id).where(Orphan.code.like("ORF-DEMO%")))
            )
        )
        # 6. Documents (linked to demo orphans / guardians / families)
        await db.execute(
            text(
                f"DELETE FROM documents WHERE orphan_id IN ({orphan_ids.text}) "
                f"OR family_id IN ({family_ids.text}) "
                f"OR guardian_id IN ({guardian_by_family.text})"
            )
        )
        # 7. Payments
        await db.execute(delete(Payment).where(Payment.code.like("PAY-DEMO%")))
        # 8. Sponsorships
        await db.execute(delete(Sponsorship).where(Sponsorship.code.like("KAF-DEMO%")))
        # 9. Orphans
        await db.execute(delete(Orphan).where(Orphan.code.like("ORF-DEMO%")))
        # 9b. Orphanages — ordered AFTER orphans (orphans.orphanage_id →
        #     orphanages) and BEFORE partner orgs (orphanages.partner_
        #     organization_id → partner_organizations).
        await db.execute(delete(Orphanage).where(Orphanage.code.like("DAR-DEMO%")))
        # 10. Guardians
        await db.execute(
            text(
                f"DELETE FROM guardians WHERE family_id IN ({family_ids.text}) "
                "OR user_id IN (SELECT id FROM users WHERE email = ANY(:emails))"
            ),
            {"emails": DEMO_USER_EMAILS},
        )
        # 11. Families
        await db.execute(delete(Family).where(Family.code.like("FAM-DEMO%")))
        # 12. Donors (+ idempotency marker)
        await db.execute(delete(Donor).where(Donor.code.like("DON-DEMO%")))
        await db.execute(delete(Donor).where(Donor.email == MARKER_EMAIL))
        # 13. Marketing channels (no code column → scope by name marker)
        await db.execute(
            delete(MarketingChannel).where(MarketingChannel.name_en.like(f"%{CHANNEL_MARKER}%"))
        )
        # 14. Partner organizations
        await db.execute(
            delete(PartnerOrganization).where(PartnerOrganization.code.like("PTN-DEMO%"))
        )
        # 15. Demo portal users (last — referenced by orphans/guardians/donors)
        await db.execute(delete(User).where(User.email.in_(DEMO_USER_EMAILS)))
        await db.commit()


async def _seed_demo() -> dict[str, int]:  # noqa: C901 — linear fixture builder
    org_id, admin_id = await _seed_org()
    rng = random.Random(42)  # deterministic so screenshots stay stable
    counts: dict[str, int] = {
        "partners": 0,
        "channels": 0,
        "families": 0,
        "guardians": 0,
        "orphans": 0,
        "orphanages": 0,
        "donors": 0,
        "sponsorships": 0,
        "payments": 0,
        "reports": 0,
        "documents": 0,
        "media": 0,
        "bank_transfers": 0,
        "messages": 0,
        "users": 0,
    }
    now = datetime.now(UTC)

    async with make_session() as db:
        # Kenya (KE) is not in the base-seeded countries, but the KE partner +
        # dar below FK to it. Insert it idempotently as reference data — the
        # wipe block deliberately leaves it in place.
        await db.execute(
            text(
                "INSERT INTO countries "
                "(code_alpha2, code_alpha3, name_ar, name_en, flag_emoji, phone_code) "
                "VALUES ('KE','KEN','كينيا','Kenya','🇰🇪','+254') "
                "ON CONFLICT (code_alpha2) DO NOTHING"
            )
        )

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

        # ── Portal users ────────────────────────────────────────────────
        def _make_user(email: str, password: str, role: str, first: str, last: str) -> User:
            return User(
                organization_id=org_id,
                email=email,
                password_hash=hash_password(password),
                first_name=first,
                last_name=last,
                role=role,
                status="active",
            )

        guardian_user_rows = [
            _make_user(u["email"], u["password"], "guardian", "Demo", f"Guardian {i + 1}")
            for i, u in enumerate(GUARDIAN_USERS)
        ]
        orphan_user_row = _make_user(
            ORPHAN_USER["email"], ORPHAN_USER["password"], "orphan", "Demo", "Orphan"
        )
        marketing_user_row = _make_user(
            MARKETING_USER["email"],
            MARKETING_USER["password"],
            "marketing_manager",
            "Demo",
            "Marketing",
        )
        orphanage_manager_user_row = _make_user(
            ORPHANAGE_MANAGER_USER["email"],
            ORPHANAGE_MANAGER_USER["password"],
            "orphanage_manager",
            "Demo",
            "Manager",
        )
        super_admin_user_row = _make_user(
            SUPER_ADMIN_USER["email"],
            SUPER_ADMIN_USER["password"],
            "super_admin",
            "Demo",
            "Super Admin",
        )
        partner_manager_user_row = _make_user(
            PARTNER_MANAGER_USER["email"],
            PARTNER_MANAGER_USER["password"],
            "partner_manager",
            "Demo",
            "Partner Manager",
        )
        partner_staff_user_row = _make_user(
            PARTNER_STAFF_USER["email"],
            PARTNER_STAFF_USER["password"],
            "partner_staff",
            "Demo",
            "Partner Staff",
        )
        kenya_intake_user_row = _make_user(
            KENYA_INTAKE_USER["email"],
            KENYA_INTAKE_USER["password"],
            "partner_staff",
            "Kenya",
            "Intake",
        )
        finance_user_row = _make_user(
            FINANCE_USER["email"],
            FINANCE_USER["password"],
            "finance",
            "Demo",
            "Finance",
        )
        viewer_user_row = _make_user(
            VIEWER_USER["email"],
            VIEWER_USER["password"],
            "viewer",
            "Demo",
            "Viewer",
        )
        donor_user_rows = [
            _make_user(u["email"], u["password"], "donor", "Demo", f"Donor {i + 1}")
            for i, u in enumerate(DONOR_USERS)
        ]
        for u in (
            *guardian_user_rows,
            orphan_user_row,
            marketing_user_row,
            orphanage_manager_user_row,
            super_admin_user_row,
            partner_manager_user_row,
            partner_staff_user_row,
            kenya_intake_user_row,
            finance_user_row,
            viewer_user_row,
            *donor_user_rows,
        ):
            db.add(u)
        # 9 singleton rows: orphan, marketing, orphanage_manager, super_admin,
        # partner_manager, partner_staff, kenya_intake, finance, viewer.
        counts["users"] = len(guardian_user_rows) + 9 + len(donor_user_rows)

        # ── Partners (PS / EG / YE) ──────────────────────────────────────
        partners: list[PartnerOrganization] = []
        for fx in PARTNER_FIXTURES:
            p = PartnerOrganization(
                organization_id=org_id,
                code=_code("PTN"),
                name_ar=fx["name_ar"],
                name_en=fx["name_en"],
                country_code=fx["country_code"],
                contact_person=fx["contact_person"],
                contact_email=fx["contact_email"],
                contact_phone=fx["contact_phone"],
                status="active",
            )
            db.add(p)
            partners.append(p)
        counts["partners"] = len(partners)

        # ── Marketing channels ───────────────────────────────────────────
        channels: list[MarketingChannel] = []
        for fx in CHANNEL_FIXTURES:
            c = MarketingChannel(
                organization_id=org_id,
                name_ar=fx["name_ar"],
                name_en=fx["name_en"],
                channel_type=fx["channel_type"],
                description=f"قناة تسويقية تجريبية — {fx['name_ar']}",
                annual_goal_count=fx["annual_goal_count"],
                annual_goal_amount=fx["annual_goal_amount"],
                goal_year=date.today().year,
                goal_currency="KWD",
                status="active",
            )
            db.add(c)
            channels.append(c)
        counts["channels"] = len(channels)

        await db.flush()  # partner / channel / user IDs now populated

        # ── Families ─────────────────────────────────────────────────────
        families: list[Family] = []
        for i, fx in enumerate(FAMILY_FIXTURES):
            fam = Family(
                organization_id=org_id,
                partner_organization_id=partners[i % len(partners)].id,
                code=_code("FAM"),
                family_name=fx["family_name"],
                deceased_father_name=fx["deceased_father"],
                father_death_date=date(2019 + (i % 4), 1 + (i % 12), 10),
                father_death_cause="مرض" if i % 2 == 0 else "حادث",
                country_code=partners[i % len(partners)].country_code,
                city=fx["city"],
                housing_status=fx["housing"],
                monthly_income=Decimal(fx["income"]),
                income_currency="USD",
                notes=f"أسرة {fx['family_name']} — بيانات تجريبية.",
                created_by=admin_id,
            )
            db.add(fam)
            families.append(fam)
        counts["families"] = len(families)

        await db.flush()

        # ── Guardians (one per family) ───────────────────────────────────
        guardians: list[Guardian] = []
        for i, fx in enumerate(GUARDIAN_FIXTURES):
            # First two guardians get a portal login.
            user_id = guardian_user_rows[i].id if i < len(guardian_user_rows) else None
            g = Guardian(
                organization_id=org_id,
                family_id=families[i].id,
                user_id=user_id,
                full_name=fx["full_name"],
                gender=fx["gender"],
                relation=fx["relation"],
                date_of_birth=date(1975 + i, 3, 12),
                phone=f"+96650{1000000 + i}",
                whatsapp=f"+96650{1000000 + i}",
                email=GUARDIAN_USERS[i]["email"] if user_id else None,
                literacy_level=rng.choice(["illiterate", "low", "medium"]),
                preferred_communication="whatsapp",
                status="active",
            )
            db.add(g)
            guardians.append(g)
        counts["guardians"] = len(guardians)

        # ── Orphans (20 across families) ─────────────────────────────────
        orphans: list[Orphan] = []
        for i in range(20):
            fam = families[i % len(families)]
            partner = partners[i % len(partners)]
            gender = "M" if i % 2 == 0 else "F"
            first = rng.choice(MALE_NAMES if gender == "M" else FEMALE_NAMES)
            # ages 5–17
            birth_year = date.today().year - rng.randint(5, 17)
            dob = date(birth_year, rng.randint(1, 12), rng.randint(1, 28))
            user_id = None
            if i == 0:
                # Portal-test orphan: age 14.
                dob = date(date.today().year - 14, 5, 15)
                user_id = orphan_user_row.id
            o = Orphan(
                organization_id=org_id,
                partner_organization_id=partner.id,
                family_id=fam.id,
                user_id=user_id,
                code=_code("ORF"),
                first_name=first,
                family_name=fam.family_name or "",
                father_name=fam.deceased_father_name,
                father_death_date=fam.father_death_date,
                date_of_birth=dob,
                gender=gender,
                nationality=partner.country_code,
                # Assign roughly every other orphan to a channel.
                assigned_to_channel_id=channels[i % len(channels)].id if i % 2 == 0 else None,
                assigned_at=now if i % 2 == 0 else None,
                case_status="pending_review",  # adjusted below once sponsored
                is_sponsored=False,
                current_balance=Decimal("0"),
                balance_currency="KWD",
                created_by=admin_id,
            )
            # Derive the real completion% from the fields set above (leaves
            # profile_completion_score at its model default of 0).
            recompute_profile_completion(o)
            db.add(o)
            orphans.append(o)
        counts["orphans"] = len(orphans)

        # ── Orphanage (dar) — the Kenya partner runs a resident institution ─
        # Pin a few of its orphans there as residents. Flush first so we have
        # orphanage.id, then set it on the residents (UPDATEd on the final
        # commit). family_id stays set too — family + dar coexist by design.
        kenya_partner = next(p for p in partners if p.country_code == "KE")
        orphanage = Orphanage(
            organization_id=org_id,
            partner_organization_id=kenya_partner.id,
            code=_code("DAR"),
            name_ar="دار أيتام المتميّزين",
            name_en="Al-Mutamayyizin Orphanage",
            country_code="KE",
            city="نيروبي",
            status="active",
        )
        db.add(orphanage)
        await db.flush()  # populate orphanage.id
        # Link the demo orphanage_manager to this dar (manager_user_id). The
        # user was flushed above, so it already has an id.
        orphanage.manager_user_id = orphanage_manager_user_row.id
        # Tie the partner-scoped demo users (partner_manager / partner_staff /
        # kenya_intake) to the Kenya جهة — the foundation for partner-scoped
        # visibility. All rows were flushed above, so the assignment is UPDATEd
        # on the final commit.
        partner_manager_user_row.partner_organization_id = kenya_partner.id
        partner_staff_user_row.partner_organization_id = kenya_partner.id
        kenya_intake_user_row.partner_organization_id = kenya_partner.id
        residents = [o for o in orphans if o.partner_organization_id == kenya_partner.id][:3]
        for o in residents:
            o.orphanage_id = orphanage.id
        counts["orphanages"] = 1

        # ── Donors (15) ──────────────────────────────────────────────────
        donors: list[Donor] = []
        for i, fx in enumerate(DONOR_FIXTURES):
            # Link the first two donors to login accounts.
            user_id = donor_user_rows[i].id if i < len(donor_user_rows) else None
            d = Donor(
                organization_id=org_id,
                user_id=user_id,
                code=_code("DON"),
                full_name=fx["full_name"],
                email=fx["email"],
                preferred_currency=fx["currency"],
                country_of_residence="KW",
                acquisition_channel=channels[i % len(channels)].channel_type,
                acquisition_channel_id=channels[i % len(channels)].id,
                is_zakat_donor=(i % 3 == 0),
                status="active",
            )
            db.add(d)
            donors.append(d)
        counts["donors"] = len(donors)

        await db.flush()  # orphan / donor / guardian IDs now populated

        # ── Sponsorships (12, varied statuses) ───────────────────────────
        # active (most), then paused, overdue, completed.
        sp_statuses = ["active"] * 6 + ["paused"] * 2 + ["overdue"] * 2 + ["completed"] * 2
        sponsorships: list[Sponsorship] = []
        for i, status in enumerate(sp_statuses):
            donor = donors[i]
            orphan = orphans[i]
            amount = Decimal(rng.choice(["10.00", "15.00", "20.00", "25.00", "30.00", "50.00"]))
            start = date.today() - timedelta(days=rng.randint(60, 540))
            end: date | None = None
            cancelled_at: datetime | None = None
            months_overdue = 0
            next_payment: date | None = _next_monthly(date.today())
            if status == "overdue":
                months_overdue = rng.randint(1, 3)
                next_payment = date.today() - timedelta(days=30 * months_overdue)
            elif status == "completed":
                end = date.today() - timedelta(days=rng.randint(10, 90))
                next_payment = None
            sp = Sponsorship(
                organization_id=org_id,
                code=_code("KAF"),
                donor_id=donor.id,
                orphan_id=orphan.id,
                marketing_channel_id=channels[i % len(channels)].id,
                monthly_amount=amount,
                currency=donor.preferred_currency or "KWD",
                start_date=start,
                end_date=end,
                payment_frequency="monthly",
                payment_method=rng.choice(["knet", "credit_card", "bank_transfer"]),
                next_payment_date=next_payment,
                status=status,
                months_overdue=months_overdue,
                cancelled_at=cancelled_at,
                total_paid=Decimal("0"),
                payments_count=0,
                acquisition_source=channels[i % len(channels)].channel_type,
                created_by=admin_id,
            )
            db.add(sp)
            sponsorships.append(sp)

            # Reflect sponsorship state on the orphan.
            if status in ("active", "paused", "overdue"):
                orphan.is_sponsored = True
                orphan.case_status = "sponsored"
            else:  # completed → back to available
                orphan.case_status = "available"
        counts["sponsorships"] = len(sponsorships)

        # Remaining (un-sponsored) orphans get a spread of case statuses.
        leftover_statuses = ["available", "approved", "pending_review", "available"]
        for j, orphan in enumerate(orphans[len(sponsorships) :]):
            orphan.case_status = leftover_statuses[j % len(leftover_statuses)]

        await db.flush()

        # ── Payments (spanning the last 6 months) ────────────────────────
        methods = ["knet", "credit_card", "bank_transfer", "debit_card", "cash"]
        for sp in sponsorships:
            # 1 payment per month back to (at most) 6 months ago.
            n_months = 6 if sp.status in ("active", "completed") else rng.randint(2, 4)
            for k in range(1, n_months + 1):
                month_start, _ = _month_window(k)
                completed_at = datetime(
                    month_start.year, month_start.month, min(15, 28), 12, 0, tzinfo=UTC
                )
                # Mostly completed, with the occasional pending / failed.
                roll = rng.random()
                if roll < 0.82:
                    pay_status = "completed"
                elif roll < 0.92:
                    pay_status = "pending"
                else:
                    pay_status = "failed"
                pay_code = _code("PAY")
                pay = Payment(
                    organization_id=org_id,
                    code=pay_code,
                    donor_id=sp.donor_id,
                    sponsorship_id=sp.id,
                    orphan_id=sp.orphan_id,
                    amount=sp.monthly_amount,
                    currency=sp.currency,
                    payment_method=rng.choice(methods),
                    acquisition_channel_id=sp.marketing_channel_id,
                    status=pay_status,
                    completed_at=completed_at if pay_status == "completed" else None,
                    failed_at=completed_at if pay_status == "failed" else None,
                    failure_reason="بطاقة مرفوضة" if pay_status == "failed" else None,
                    receipt_number=("RCP-" + pay_code.split("-", 1)[1])
                    if pay_status == "completed"
                    else None,
                    receipt_issued_at=completed_at if pay_status == "completed" else None,
                )
                db.add(pay)
                counts["payments"] += 1
                if pay_status == "completed":
                    sp.total_paid = (sp.total_paid or Decimal("0")) + sp.monthly_amount
                    sp.payments_count = (sp.payments_count or 0) + 1
                    sp.last_payment_date = completed_at.date()
                    sp.last_payment_amount = sp.monthly_amount

        # ── Orphan reports (2 per sponsored orphan) ──────────────────────
        report_statuses = ["draft", "pending_partner_approval", "published_to_donor"]
        sponsored_orphans = [o for o in orphans if o.case_status == "sponsored"]
        for idx, orphan in enumerate(sponsored_orphans):
            for r in range(2):
                status = report_statuses[(idx + r) % len(report_statuses)]
                p_start, p_end = _month_window(r + 1)
                submitted_at: datetime | None = None
                partner_approved_at: datetime | None = None
                published_at: datetime | None = None
                if status in ("pending_partner_approval", "published_to_donor"):
                    submitted_at = now - timedelta(days=10 * (r + 1))
                if status == "published_to_donor" and submitted_at is not None:
                    partner_approved_at = submitted_at + timedelta(days=2)
                    published_at = submitted_at + timedelta(days=4)
                # Donor-facing extras only matter once the report is published.
                # All sections stay visible by default (section_visibility={}).
                published = status == "published_to_donor"
                rep = OrphanReport(
                    organization_id=org_id,
                    orphan_id=orphan.id,
                    report_type="monthly",
                    period_start=p_start,
                    period_end=p_end,
                    educational_progress={
                        "stage": "ابتدائي",
                        "school_name": "مدرسة الحي",
                        "overall_rating": "excellent",
                        "attendance_percent": 95,
                        "subjects": [
                            {"name": "اللغة العربية", "grade": "ممتاز"},
                            {"name": "الرياضيات", "grade": "جيد جدًا"},
                        ],
                        "note": "تحسّن ملحوظ في القراءة هذا الشهر.",
                    },
                    quran_progress={
                        "juz_memorized": 2 + r,
                        "current_juz": 3 + r,
                        "evaluation": "very_good",
                        "recent": "سورة يس",
                        "note": "يواظب على حلقة التحفيظ مرتين أسبوعيًا.",
                    },
                    activities={
                        "items": [{"title": "نشاط رياضي", "note": None}],
                        "note": "مشاركة جيدة",
                    },
                    health_status={"general": "good", "note": "الحالة الصحية مستقرة."},
                    psychological_status={
                        "mood": "good",
                        "social": "good",
                        "note": "اندماج جيد مع الأقران.",
                    },
                    summary=(
                        f"تقرير شهري عن {orphan.first_name}: تحسّن ملحوظ في "
                        "الدراسة والحالة الصحية مستقرة، والحمد لله."
                    ),
                    section_visibility={},
                    donor_message=(
                        f"نشكر لكم كفالتكم الكريمة لـ {orphan.first_name}؛ يتقدّم "
                        "بثباتٍ ويذكركم بدعائه. جزاكم الله خيرًا."
                    )
                    if published
                    else None,
                    is_milestone=published and r == 1,
                    milestone_label="أتمّ حفظ جزء جديد" if (published and r == 1) else None,
                    photos_count=rng.randint(1, 4),
                    documents_count=rng.randint(0, 2),
                    status=status,
                    submitted_by=admin_id if submitted_at else None,
                    submitted_at=submitted_at,
                    partner_approved_by=admin_id if partner_approved_at else None,
                    partner_approved_at=partner_approved_at,
                    published_at=published_at,
                )
                db.add(rep)
                counts["reports"] += 1

        # ── Documents (1–2 per orphan) ───────────────────────────────────
        doc_types = [
            "birth_certificate",
            "death_certificate",
            "school_certificate",
            "medical_report",
            "family_record",
            "photo_id",
        ]
        verif = ["pending", "verified", "rejected"]
        for i, orphan in enumerate(orphans):
            for copy_n in range(rng.randint(1, 2)):
                dtype = doc_types[(i + copy_n) % len(doc_types)]
                doc = Document(
                    organization_id=org_id,
                    orphan_id=orphan.id,
                    family_id=orphan.family_id,
                    document_type=dtype,
                    title=f"{dtype} — {orphan.first_name}",
                    file_url=f"https://placehold.co/600x800?text={dtype}",
                    file_name=f"{dtype}_{orphan.code}.pdf",
                    file_mime_type="application/pdf",
                    file_size_bytes=rng.randint(50_000, 500_000),
                    storage_provider="local",
                    verification_status=verif[(i + copy_n) % len(verif)],
                    is_encrypted=False,
                    uploaded_by=admin_id,
                )
                db.add(doc)
                counts["documents"] += 1

        # ── Media (3–5 placeholder photos per orphan) ────────────────────
        media_statuses = ["approved", "pending", "rejected", "flagged"]
        for orphan in orphans:
            for m in range(rng.randint(3, 5)):
                mod_status = media_statuses[m % len(media_statuses)]
                visibility = "donor_only" if mod_status == "approved" else "private"
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
                             :mstatus, :vis, :uploader, :now)
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "org": str(org_id),
                        "orphan": str(orphan.id),
                        "title": f"صورة {orphan.first_name}",
                        "url": "https://placehold.co/400x400?text=Orphan+Photo",
                        "size": rng.randint(80_000, 400_000),
                        "mstatus": mod_status,
                        "vis": visibility,
                        "uploader": str(admin_id),
                        "now": now - timedelta(days=rng.randint(1, 120)),
                    },
                )
                counts["media"] += 1

        # ── Bank transfers (3, one per partner) + items ──────────────────
        bt_statuses = ["completed", "approved", "pending"]
        for i, partner in enumerate(partners):
            partner_orphans = [o for o in orphans if o.partner_organization_id == partner.id][:3]
            if not partner_orphans:
                continue
            per_orphan = Decimal("20.00")
            total = per_orphan * len(partner_orphans)
            p_start, p_end = _month_window(i + 1)
            status = bt_statuses[i % len(bt_statuses)]
            approved_at = now - timedelta(days=20) if status != "pending" else None
            executed_at = now - timedelta(days=15) if status == "completed" else None
            bt = BankTransfer(
                organization_id=org_id,
                code=_code("BNK"),
                partner_organization_id=partner.id,
                amount=total,
                currency="USD",
                bank_name="بنك الكويت الوطني",
                bank_reference=f"REF-{uuid4().hex[:8].upper()}",
                period_start=p_start,
                period_end=p_end,
                status=status,
                approved_by=admin_id if approved_at else None,
                approved_at=approved_at,
                executed_by=admin_id if executed_at else None,
                executed_at=executed_at,
                notes=f"تحويل بنكي تجريبي إلى {partner.name_ar}.",
            )
            db.add(bt)
            await db.flush()  # need bt.id for items
            for orphan in partner_orphans:
                await db.execute(
                    text(
                        """
                        INSERT INTO bank_transfer_items
                            (id, transfer_id, orphan_id, amount, currency, created_at)
                        VALUES
                            (:id, :transfer, :orphan, :amount, 'USD', :now)
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "transfer": str(bt.id),
                        "orphan": str(orphan.id),
                        "amount": per_orphan,
                        "now": now,
                    },
                )
            counts["bank_transfers"] += 1

        # ── Messages (donor users ↔ guardian users) ──────────────────────
        # Pair donor_user[i] with guardian_user[i]; alternate direction.
        pairs = list(zip(donor_user_rows, guardian_user_rows, strict=False))
        for i, fx in enumerate(MESSAGE_FIXTURES):
            donor_user, guardian_user = pairs[i % len(pairs)]
            # Even index: donor → guardian. Odd: guardian → donor.
            if i % 2 == 0:
                from_user, to_user = donor_user, guardian_user
            else:
                from_user, to_user = guardian_user, donor_user
            # Relate to an orphan of the paired guardian's family, if any.
            pair_idx = i % len(pairs)
            family = families[pair_idx] if pair_idx < len(families) else families[0]
            related = next((o for o in orphans if o.family_id == family.id), None)
            moderated_at = (
                now - timedelta(days=rng.randint(1, 30))
                if fx["status"] in ("approved", "rejected")
                else None
            )
            await db.execute(
                text(
                    """
                    INSERT INTO messages
                        (id, organization_id, from_user_id, to_user_id,
                         related_orphan_id, message_type, content,
                         moderation_status, moderated_by, moderated_at,
                         detected_language, created_at)
                    VALUES
                        (:id, :org, :from_u, :to_u,
                         :orphan, 'text', :content,
                         :mstatus, :modby, :modat,
                         'ar', :now)
                    """
                ),
                {
                    "id": str(uuid4()),
                    "org": str(org_id),
                    "from_u": str(from_user.id),
                    "to_u": str(to_user.id),
                    "orphan": str(related.id) if related else None,
                    "content": fx["content"],
                    "mstatus": fx["status"],
                    "modby": str(admin_id) if moderated_at else None,
                    "modat": moderated_at,
                    "now": now - timedelta(days=rng.randint(1, 60)),
                },
            )
            counts["messages"] += 1

        # ── Roll donor aggregates up from their sponsorships ─────────────
        for donor in donors:
            donor_sps = [s for s in sponsorships if s.donor_id == donor.id]
            donor.total_sponsorships = len(donor_sps)
            donor.active_sponsorships = sum(1 for s in donor_sps if s.status == "active")
            donor.total_donated = sum(
                (s.total_paid or Decimal("0") for s in donor_sps), Decimal("0")
            )
            donor.total_donated_currency = donor.preferred_currency

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
        "✔ seeded demo data: "
        f"{counts['partners']} partners, "
        f"{counts['channels']} channels, "
        f"{counts['families']} families, "
        f"{counts['guardians']} guardians, "
        f"{counts['orphans']} orphans, "
        f"{counts['orphanages']} orphanages, "
        f"{counts['donors']} donors, "
        f"{counts['sponsorships']} sponsorships, "
        f"{counts['payments']} payments, "
        f"{counts['reports']} reports, "
        f"{counts['documents']} documents, "
        f"{counts['media']} media, "
        f"{counts['bank_transfers']} bank transfers, "
        f"{counts['messages']} messages, "
        f"{counts['users']} portal users"
    )
    print("\nTest credentials:")
    print(f"  admin     → {SEED_ADMIN_EMAIL} / admin12345")
    for u in GUARDIAN_USERS:
        print(f"  guardian  → {u['email']} / {u['password']}")
    print(f"  orphan    → {ORPHAN_USER['email']} / {ORPHAN_USER['password']}")
    print(f"  marketing → {MARKETING_USER['email']} / {MARKETING_USER['password']}")
    print(f"  manager   → {ORPHANAGE_MANAGER_USER['email']} / {ORPHANAGE_MANAGER_USER['password']}")
    print(f"  super     → {SUPER_ADMIN_USER['email']} / {SUPER_ADMIN_USER['password']}")
    print(f"  partner   → {PARTNER_MANAGER_USER['email']} / {PARTNER_MANAGER_USER['password']}")
    print(f"  staff     → {PARTNER_STAFF_USER['email']} / {PARTNER_STAFF_USER['password']}")
    print(f"  kenya-intake → {KENYA_INTAKE_USER['email']} / {KENYA_INTAKE_USER['password']}")
    print(f"  finance   → {FINANCE_USER['email']} / {FINANCE_USER['password']}")
    print(f"  viewer    → {VIEWER_USER['email']} / {VIEWER_USER['password']}")
    for u in DONOR_USERS:
        print(f"  donor     → {u['email']} / {u['password']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="wipe and recreate")
    args = parser.parse_args()
    asyncio.run(main(args.force))
