"""Re-runnable **demo seed** for the local dev environment.

Populates a single demo organisation — *جمعية النجاة الخيرية* (Al-Najat, code
``NJT``, Kuwait / KWD / ar) — with a complete, realistic dataset so the whole
donor experience and the orphan-report workflow can be reviewed end-to-end:

* 1 organisation + its ``business_rules`` row + 5 partner organisations;
* ~15 families and their guardians (encrypted national IDs);
* 50 orphans (ages 3–17, both genders, every current field populated), each with
  a gender-based profile photo uploaded to MinIO and 3–5 sample documents;
* ~12 donors (2 with portal logins — credentials printed at the end);
* ~35 sponsorships with a full monthly payment history;
* 3–6 periodic reports per sponsored orphan — most published to donors (so they
  show in the donor view), a few left in draft/pending to show the approval
  workflow — each published report carrying donor-only sample media;
* the remaining ~15 orphans spread across the available/pending/reserved
  pipeline with no sponsorship.

Design / safety
---------------
* **Dev/local only.** Refuses to run (non-zero exit) when ``ENVIRONMENT`` looks
  like production or the database DSN does not point at a recognised local host.
* **Goes through the ORM + the app's own services** — never raw SQL that would
  bypass encryption, the blind index or code generation. National IDs are
  written through :func:`app.core.crypto.encrypt_field` (+ the deterministic
  :func:`~app.core.crypto.national_id_blind_index` for orphans) so the
  decrypt-on-read staff endpoints keep working. ``media`` and ``business_rules``
  have no ORM model, so they use parameterised SQL — the same as the app does.
* **Sets ``organization_id`` explicitly on every row.** The seed connects as the
  table owner, which bypasses Row-Level Security, so writes are *not* scoped by
  the ``app.current_org_id`` GUC — every row is pinned to the demo org by hand.
* **Idempotent.** Identity-bearing rows are upserted by a stable, demo-tagged
  code (``ORF-DEMO-001`` … ``ORF-DEMO-050`` etc.); the regenerable children
  (payments, reports, documents, media) are rebuilt from scratch each run. A
  second run neither duplicates rows nor crashes.
* **``--purge``** deletes *only* the seeded rows (everything scoped to the demo
  org) in FK-safe order, then the org itself.

Usage::

    docker compose exec backend python -m scripts.seed_demo
    docker compose exec backend python -m scripts.seed_demo --purge

(Locally, from the backend directory: ``python -m scripts.seed_demo``.)
Run ``alembic upgrade head`` first — the reference country seed (migrations
0001/0019) is a prerequisite for the orphan-nationality FKs.
"""

from __future__ import annotations

import argparse
import asyncio
import calendar
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import encrypt_field, national_id_blind_index
from app.core.database import make_session
from app.core.security import hash_password
from app.models.document import Document
from app.models.donor import Donor
from app.models.family import Family, Guardian
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User
from app.services.orphans import recompute_profile_completion, stamp_available_since
from app.services.storage import ensure_bucket, put_object

# ── Demo identity ─────────────────────────────────────────────────────────────
ORG_CODE = "NJT"
ORG_NAME_AR = "جمعية النجاة الخيرية"
ORG_NAME_EN = "Al-Najat Charity"

# Stable, demo-tagged code prefixes — the ``-DEMO-`` marker makes every seeded
# row trivially identifiable and is the idempotency key.
PARTNER_CODE = "PTN-DEMO-{:02d}"
FAMILY_CODE = "FAM-DEMO-{:02d}"
ORPHAN_CODE = "ORF-DEMO-{:03d}"
DONOR_CODE = "DON-DEMO-{:02d}"
SPONSORSHIP_CODE = "KAF-DEMO-{:03d}"
PAYMENT_CODE = "PAY-DEMO-{:06d}"
RECEIPT_NUMBER = "RCP-DEMO-{:06d}"

ASSETS_DIR = Path(__file__).resolve().parent / "seed_assets"
ASSET_BUCKET = settings.S3_BUCKET_PRIVATE

# ── Demo logins (clearly fake; printed at the end) ────────────────────────────
STAFF_LOGIN = {
    "email": "admin.najat@demo.rufaqaa.app",
    "password": "AdminNajat#2026",
    "role": "org_admin",
    "first_name": "نجاة",
    "last_name": "المشرف",
}
# Donors that get a portal login, keyed by their index in DONOR_FIXTURES. The
# first sponsors several orphans that have rich published reports.
DONOR_LOGINS: dict[int, dict[str, str]] = {
    0: {"email": "donor.najat@demo.rufaqaa.app", "password": "DonorNajat#2026"},
    4: {"email": "donor.yousef@demo.rufaqaa.app", "password": "DonorYousef#2026"},
}

# ── Fixtures ──────────────────────────────────────────────────────────────────
# Partner organisations across seeded countries (migrations 0001/0019).
PARTNER_FIXTURES: list[dict[str, str]] = [
    {
        "name_ar": "جمعية الإحسان الفلسطينية",
        "name_en": "Al-Ihsan Palestine Charity",
        "country_code": "PS",
        "contact_person": "محمود العسلي",
        "contact_email": "info@ihsan-ps.example",
        "contact_phone": "+970591234501",
    },
    {
        "name_ar": "مؤسسة الرحمة المصرية",
        "name_en": "Al-Rahma Egypt Foundation",
        "country_code": "EG",
        "contact_person": "أحمد فؤاد",
        "contact_email": "info@rahma-eg.example",
        "contact_phone": "+201001234502",
    },
    {
        "name_ar": "جمعية الخير اليمنية",
        "name_en": "Al-Khair Yemen Society",
        "country_code": "YE",
        "contact_person": "علي المقطري",
        "contact_email": "info@khair-ye.example",
        "contact_phone": "+967711234503",
    },
    {
        "name_ar": "مؤسسة الشام للإغاثة",
        "name_en": "Al-Sham Relief Foundation",
        "country_code": "SY",
        "contact_person": "سمير الحلبي",
        "contact_email": "info@sham-sy.example",
        "contact_phone": "+963991234504",
    },
    {
        "name_ar": "جمعية البر الأردنية",
        "name_en": "Al-Birr Jordan Society",
        "country_code": "JO",
        "contact_person": "ربى السعدي",
        "contact_email": "info@birr-jo.example",
        "contact_phone": "+962791234505",
    },
]

FAMILY_SURNAMES = [
    "العبدالله",
    "الشمري",
    "البلوشي",
    "الحمد",
    "السالم",
    "المحمود",
    "الخطيب",
    "النجار",
    "القحطاني",
    "الدوسري",
    "العتيبي",
    "المطيري",
    "الرشيدي",
    "العنزي",
    "الحربي",
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
    "سعد",
    "ماجد",
    "طارق",
    "بلال",
    "زيد",
    "أنس",
    "ياسين",
    "مصطفى",
    "حمزة",
    "سامي",
    "نواف",
    "فيصل",
    "راشد",
    "سلمان",
]
FEMALE_NAMES = [
    "فاطمة",
    "عائشة",
    "خديجة",
    "مريم",
    "زينب",
    "سارة",
    "نور",
    "رقية",
    "آمنة",
    "هدى",
    "ليلى",
    "جنى",
    "رهف",
    "سلمى",
    "ميساء",
    "أسماء",
    "حنين",
    "ملك",
    "رنا",
    "دعاء",
    "شهد",
    "لمى",
    "غيداء",
    "بشرى",
]

CITIES_BY_COUNTRY: dict[str, list[str]] = {
    "PS": ["غزة", "خان يونس", "رفح", "نابلس", "الخليل"],
    "EG": ["القاهرة", "الإسكندرية", "الجيزة", "المنصورة", "أسيوط"],
    "YE": ["صنعاء", "تعز", "عدن", "الحديدة", "إب"],
    "SY": ["دمشق", "حلب", "حمص", "حماة", "درعا"],
    "JO": ["عمّان", "الزرقاء", "إربد", "المفرق", "الرصيفة"],
}

HOUSING_STATUSES = ["owned", "rented", "donated", "homeless"]
GUARDIAN_RELATIONS = ["mother", "grandfather", "uncle", "grandmother", "aunt", "sibling"]
LITERACY_LEVELS = ["illiterate", "low", "medium", "high"]
HEALTH_STATUSES = ["good", "good", "good", "chronic_condition", "under_treatment", "disability"]
HEALTH_COVERAGES = ["none", "government", "charity", "private"]
MOTHER_STATUSES = ["deceased", "alive", "unknown", "alive"]
PRIORITY_LEVELS = ["normal", "normal", "high", "urgent"]
LIVES_WITH = ["mother", "relative", "orphanage", "other"]
ACADEMIC_LEVELS = ["weak", "good", "excellent"]
ORPHAN_TAGS = ["متفوق", "حافظ", "رياضي", "فنان", "يحتاج دعم نفسي", "حالة صحية", "موهوب"]

DOCUMENT_TYPES = [
    "birth_certificate",
    "death_certificate",
    "school_certificate",
    "medical_report",
    "family_record",
    "custody_declaration",
    "photo_id",
]
VERIFICATION_STATUSES = ["verified", "verified", "pending", "rejected"]

# Donors: name, country_of_residence, preferred_currency.
DONOR_FIXTURES: list[dict[str, str]] = [
    {"full_name": "عبدالله المطيري", "country": "KW", "currency": "KWD"},
    {"full_name": "نورة العتيبي", "country": "SA", "currency": "SAR"},
    {"full_name": "عبدالرحمن الصباح", "country": "KW", "currency": "KWD"},
    {"full_name": "فاطمة حسن", "country": "AE", "currency": "AED"},
    {"full_name": "Yousef Rahman", "country": "US", "currency": "USD"},
    {"full_name": "Layla Ahmed", "country": "GB", "currency": "GBP"},
    {"full_name": "سالم الفهد", "country": "KW", "currency": "KWD"},
    {"full_name": "مريم الصباح", "country": "KW", "currency": "KWD"},
    {"full_name": "خالد الدوسري", "country": "SA", "currency": "SAR"},
    {"full_name": "Omar Khalil", "country": "US", "currency": "USD"},
    {"full_name": "هند القحطاني", "country": "SA", "currency": "SAR"},
    {"full_name": "Aisha Malik", "country": "GB", "currency": "GBP"},
]

# Sponsorship economics. Currency is constrained to KWD/USD (per the brief); the
# default-currency conversion below mirrors a fixed demo FX rate.
KWD_AMOUNTS = [Decimal(x) for x in ("10.00", "15.00", "20.00", "25.00", "30.00")]
USD_AMOUNTS = [Decimal(x) for x in ("25.00", "40.00", "50.00", "75.00", "90.00")]
USD_TO_KWD = Decimal("0.307")

TOTAL_ORPHANS = 50
SPONSORED_ORPHANS = 35  # the remaining 15 populate the pipeline

RNG_SEED = 2026


# ── Safety guard ──────────────────────────────────────────────────────────────
_LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db", "host.docker.internal"}
_MANAGED_DB_MARKERS = (
    "rds.amazonaws",
    "neon.tech",
    "supabase",
    "render.com",
    "azure",
    "digitalocean",
    "ondigitalocean",
    "googleapis",
    "cloud.timescale",
)


def _assert_local_dev() -> None:
    """Abort (non-zero) unless this clearly looks like a local/dev database."""
    env = settings.ENVIRONMENT
    url = make_url(str(settings.DATABASE_URL))
    host = (url.host or "").lower()

    problems: list[str] = []
    if env == "production":
        problems.append(f"ENVIRONMENT is {env!r} (refusing on production)")
    if host not in _LOCAL_DB_HOSTS:
        problems.append(
            f"database host {host!r} is not a recognised local host "
            f"(expected one of {sorted(_LOCAL_DB_HOSTS)})"
        )
    if any(marker in host for marker in _MANAGED_DB_MARKERS):
        problems.append(f"database host {host!r} looks like a managed/cloud database")

    if problems:
        print("✖ REFUSING TO RUN — scripts.seed_demo is for LOCAL / DEV only.")
        for problem in problems:
            print(f"    • {problem}")
        print(f"    detected ENVIRONMENT={env!r}, db host={host!r}, db name={url.database!r}")
        print("    Nothing was written. Aborting.")
        raise SystemExit(2)


# ── Date helpers ──────────────────────────────────────────────────────────────
def _add_months(anchor: date, months: int) -> date:
    total = anchor.month - 1 + months
    year = anchor.year + total // 12
    month = total % 12 + 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _months_between(start: date, end: date) -> int:
    """Whole months from ``start`` up to and including ``end`` (>= 0)."""
    return max(0, (end.year - start.year) * 12 + (end.month - start.month))


def _month_window(months_ago: int, today: date) -> tuple[date, date]:
    """First/last calendar day of the month ``months_ago`` months before today."""
    first = _add_months(date(today.year, today.month, 1), -months_ago)
    last = date(first.year, first.month, calendar.monthrange(first.year, first.month)[1])
    return first, last


# ── Asset (image / document) helpers ──────────────────────────────────────────
def _detect_content_type(data: bytes, filename: str) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    head = data[:256].lstrip().lower()
    if head.startswith((b"<?xml", b"<svg")) or b"<svg" in head:
        return "image/svg+xml"
    if filename.lower().endswith(".svg"):
        return "image/svg+xml"
    return "application/octet-stream"


def _gender_avatar_svg(gender: str) -> bytes:
    """Stdlib fallback when seed_assets/boy.jpg|girl.jpg is missing — a simple,
    obviously-illustrative, gender-coloured avatar (no PII)."""
    bg, fg = ("#769FCD", "#284E78") if gender == "M" else ("#F4A6C0", "#A8406E")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'
        f'<rect width="512" height="512" fill="{bg}"/>'
        f'<circle cx="256" cy="205" r="95" fill="{fg}"/>'
        f'<rect x="106" y="360" width="300" height="200" rx="80" fill="{fg}"/>'
        '<text x="256" y="470" font-family="Arial, sans-serif" font-size="54" '
        'font-weight="bold" fill="#ffffff" text-anchor="middle">DEMO</text>'
        "</svg>"
    )
    return svg.encode("utf-8")


def _sample_document_svg() -> bytes:
    """Stdlib fallback for the reusable sample-document placeholder."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">'
        '<rect width="600" height="800" fill="#f7f7f5"/>'
        '<rect x="20" y="20" width="560" height="760" fill="#ffffff" '
        'stroke="#c9ccd1" stroke-width="2"/>'
        '<g transform="rotate(-28 300 420)">'
        '<rect x="40" y="360" width="520" height="120" rx="14" fill="#fdecef" '
        'stroke="#d23f57" stroke-width="3"/>'
        '<text x="300" y="408" font-family="Arial, sans-serif" font-size="44" '
        'font-weight="bold" fill="#d23f57" text-anchor="middle">عينة / SAMPLE</text>'
        '<text x="300" y="452" font-family="Arial, sans-serif" font-size="22" '
        'font-weight="bold" fill="#d23f57" text-anchor="middle">NOT A REAL DOCUMENT</text>'
        "</g></svg>"
    )
    return svg.encode("utf-8")


def _resolve_profile_asset(gender: str) -> tuple[bytes, str, str]:
    """Bytes, content-type and extension for the gender profile photo —
    the committed illustration if present, else a generated avatar."""
    filename = "boy.jpg" if gender == "M" else "girl.jpg"
    path = ASSETS_DIR / filename
    if path.is_file():
        data = path.read_bytes()
        return data, _detect_content_type(data, filename), path.suffix.lstrip(".") or "bin"
    return _gender_avatar_svg(gender), "image/svg+xml", "svg"


def _resolve_document_asset() -> tuple[bytes, str, str]:
    path = ASSETS_DIR / "sample_document.svg"
    if path.is_file():
        data = path.read_bytes()
        return data, _detect_content_type(data, path.name), "svg"
    return _sample_document_svg(), "image/svg+xml", "svg"


@dataclass
class DemoAssets:
    """Resolved ``s3://`` URLs for the (re)uploaded shared demo objects."""

    photo_by_gender: dict[str, str]
    document_url: str
    document_mime: str
    document_name: str


async def _upload_shared_assets() -> DemoAssets:
    """Upload the three shared demo objects (boy, girl, sample document) to
    MinIO through the app's storage layer. Stable keys → re-runs overwrite."""
    await ensure_bucket(ASSET_BUCKET)
    photo_by_gender: dict[str, str] = {}
    for gender, label in (("M", "boy"), ("F", "girl")):
        data, content_type, ext = _resolve_profile_asset(gender)
        key = f"demo/profile/{label}.{ext}"
        await put_object(ASSET_BUCKET, key, data, content_type=content_type)
        photo_by_gender[gender] = f"s3://{ASSET_BUCKET}/{key}"

    doc_data, doc_mime, doc_ext = _resolve_document_asset()
    doc_key = f"demo/documents/sample_document.{doc_ext}"
    await put_object(ASSET_BUCKET, doc_key, doc_data, content_type=doc_mime)

    return DemoAssets(
        photo_by_gender=photo_by_gender,
        document_url=f"s3://{ASSET_BUCKET}/{doc_key}",
        document_mime=doc_mime,
        document_name=f"sample_document.{doc_ext}",
    )


# ── Report content (rich Arabic JSONB) ────────────────────────────────────────
def _report_content(orphan: Orphan, period_label: str, rng: random.Random) -> dict[str, Any]:
    juz = orphan.quran_juz_memorized or 0
    grade = rng.choice(["ممتاز", "جيد جدًا", "جيد", "مقبول"])
    return {
        "educational_progress": {
            "المرحلة": orphan.education_stage or "ابتدائي",
            "المدرسة": orphan.school_name or "مدرسة الحي",
            "المعدل": grade,
            "نسبة_الحضور": f"{rng.randint(85, 100)}%",
            "ملاحظات": "أحرز تقدمًا ملحوظًا في القراءة والرياضيات هذا الفصل.",
        },
        "quran_progress": {
            "الأجزاء_المحفوظة": juz,
            "الجزء_الحالي": min(30, juz + 1),
            "التقييم": rng.choice(["متقن", "جيد جدًا", "بحاجة لمراجعة"]),
            "ملاحظات": "يواظب على حلقة التحفيظ مرتين أسبوعيًا.",
        },
        "activities": {
            "أنشطة": rng.sample(
                ["كرة القدم", "الرسم", "الكشافة", "مسابقة علمية", "رحلة ترفيهية"], k=2
            ),
            "المشاركة": rng.choice(["فعّالة", "جيدة", "متوسطة"]),
        },
        "health_status": {
            "الحالة_العامة": rng.choice(["جيدة", "مستقرة", "تحت المتابعة"]),
            "آخر_فحص": period_label,
            "ملاحظات": "لا توجد مشكلات صحية طارئة، وتم صرف المكمّلات الموسمية.",
        },
        "psychological_status": {
            "الحالة": rng.choice(["مستقرة", "إيجابية", "تحتاج دعمًا"]),
            "التفاعل_الاجتماعي": rng.choice(["جيد", "ممتاز", "متحسّن"]),
            "ملاحظات": "اندماج جيد مع الأقران ضمن الأنشطة الجماعية.",
        },
        "summary": (
            f"تقرير {period_label} عن {orphan.first_name}: الحمد لله، الحالة العامة "
            f"مستقرة وأداؤه الدراسي {grade}، ويواصل حفظ القرآن الكريم "
            f"(بلغ {juz} جزءًا). نشكر الكفيل الكريم على دعمه المتواصل."
        ),
    }


# ── Counters / summary ────────────────────────────────────────────────────────
@dataclass
class Summary:
    org_id: UUID | None = None
    partners: int = 0
    families: int = 0
    guardians: int = 0
    donors: int = 0
    donor_logins: int = 0
    orphans_by_status: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    sponsorships_by_status: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    payments_by_status: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    reports_by_status: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    documents: int = 0
    media: int = 0


# ── Generic upsert-by-lookup helpers (typed, no raw SQL) ──────────────────────
# ``AsyncSession.scalar`` is typed ``Any``; assign to an annotated local before
# returning so the public signature stays precise (mirrors services/orphans.py).
async def _get_partner(db: AsyncSession, code: str) -> PartnerOrganization | None:
    row: PartnerOrganization | None = await db.scalar(
        select(PartnerOrganization).where(PartnerOrganization.code == code)
    )
    return row


async def _get_family(db: AsyncSession, code: str) -> Family | None:
    row: Family | None = await db.scalar(select(Family).where(Family.code == code))
    return row


async def _get_orphan(db: AsyncSession, code: str) -> Orphan | None:
    row: Orphan | None = await db.scalar(select(Orphan).where(Orphan.code == code))
    return row


async def _get_donor(db: AsyncSession, code: str) -> Donor | None:
    row: Donor | None = await db.scalar(select(Donor).where(Donor.code == code))
    return row


async def _get_user(db: AsyncSession, email: str) -> User | None:
    row: User | None = await db.scalar(select(User).where(User.email == email))
    return row


async def _get_sponsorship(db: AsyncSession, code: str) -> Sponsorship | None:
    row: Sponsorship | None = await db.scalar(select(Sponsorship).where(Sponsorship.code == code))
    return row


def _national_id(country: str, seq: int) -> str:
    """A unique, ASCII, plausibly-formatted national id for ``seq``."""
    if country == "EG":  # documented: 14 numeric digits
        return f"{29800000000000 + seq:014d}"
    if country == "JO":  # documented: 10 numeric digits
        return f"{9800000000 + seq:010d}"
    return f"{country}{100000 + seq:06d}"  # conflict countries: informal reference


# ── Core seed ─────────────────────────────────────────────────────────────────
async def _seed(db: AsyncSession, assets: DemoAssets) -> Summary:
    rng = random.Random(RNG_SEED)
    now = datetime.now(UTC)
    today = now.date()
    summary = Summary()

    # ── Organisation (get-or-create by code) ──────────────────────────────────
    org = await db.scalar(select(Organization).where(Organization.code == ORG_CODE))
    if org is None:
        org = Organization(
            code=ORG_CODE,
            name_ar=ORG_NAME_AR,
            name_en=ORG_NAME_EN,
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
            timezone="Asia/Kuwait",
            default_language="ar",
            default_currency="KWD",
            status="active",
            settings={"demo_seed": True},
        )
        db.add(org)
        await db.flush()
    org_id = org.id
    summary.org_id = org_id

    # business_rules — one row per org (no ORM model). Defaults cover the rest.
    await db.execute(
        text(
            """
            INSERT INTO business_rules
                (organization_id, monthly_report_required,
                 require_double_approval_for_reports, require_double_approval_for_media)
            VALUES (:org, TRUE, TRUE, TRUE)
            ON CONFLICT (organization_id) DO NOTHING
            """
        ),
        {"org": str(org_id)},
    )

    # ── Replace regenerable children up-front (idempotent re-run) ──────────────
    # Identity-bearing rows below are upserted by code; these have no stable code,
    # so we wipe the demo-org-scoped set and rebuild it. Order: media → reports →
    # documents → payments (children before the parents they reference).
    await db.execute(text("DELETE FROM media WHERE organization_id = :o"), {"o": str(org_id)})
    await db.execute(delete(OrphanReport).where(OrphanReport.organization_id == org_id))
    await db.execute(delete(Document).where(Document.organization_id == org_id))
    await db.execute(delete(Payment).where(Payment.organization_id == org_id))

    # ── Staff admin login (created_by / submitted_by / uploaded_by) ────────────
    admin = await _get_user(db, STAFF_LOGIN["email"])
    if admin is None:
        admin = User(
            organization_id=org_id,
            email=STAFF_LOGIN["email"],
            password_hash=hash_password(STAFF_LOGIN["password"]),
            first_name=STAFF_LOGIN["first_name"],
            last_name=STAFF_LOGIN["last_name"],
            role=STAFF_LOGIN["role"],
            language="ar",
            status="active",
            email_verified_at=now,
        )
        db.add(admin)
        await db.flush()
    admin_id = admin.id

    # ── Partners ───────────────────────────────────────────────────────────────
    partners: list[PartnerOrganization] = []
    for i, fixture in enumerate(PARTNER_FIXTURES, start=1):
        code = PARTNER_CODE.format(i)
        partner = await _get_partner(db, code)
        if partner is None:
            partner = PartnerOrganization(
                organization_id=org_id,
                code=code,
                name_ar=fixture["name_ar"],
                name_en=fixture["name_en"],
                country_code=fixture["country_code"],
                contact_person=fixture["contact_person"],
                contact_email=fixture["contact_email"],
                contact_phone=fixture["contact_phone"],
                status="active",
            )
            db.add(partner)
        partners.append(partner)
    await db.flush()
    summary.partners = len(partners)

    # ── Families + guardians ───────────────────────────────────────────────────
    families: list[Family] = []
    family_father: list[str] = []  # deceased father's full name, by family index
    for i, surname in enumerate(FAMILY_SURNAMES):
        partner = partners[i % len(partners)]
        country = partner.country_code
        father_first = MALE_NAMES[(i * 3) % len(MALE_NAMES)]
        father_full = f"{father_first} {surname}"
        family_father.append(father_full)
        code = FAMILY_CODE.format(i + 1)
        family = await _get_family(db, code)
        if family is None:
            family = Family(
                organization_id=org_id,
                partner_organization_id=partner.id,
                code=code,
                family_name=surname,
                deceased_father_name=father_full,
                father_death_date=date(2016 + (i % 7), 1 + (i % 12), 1 + (i % 27)),
                father_death_cause=rng.choice(["مرض", "حادث", "نزاع مسلح"]),
                country_code=country,
                governorate=rng.choice(CITIES_BY_COUNTRY[country]),
                city=rng.choice(CITIES_BY_COUNTRY[country]),
                district=f"حي {rng.randint(1, 9)}",
                housing_status=rng.choice(HOUSING_STATUSES),
                monthly_income=Decimal(rng.randint(60, 300)),
                income_currency="USD",
                notes=f"أسرة {surname} — بيانات تجريبية للعرض.",
                created_by=admin_id,
            )
            db.add(family)
        families.append(family)
    await db.flush()
    summary.families = len(families)

    guardians: list[Guardian] = []
    for i, family in enumerate(families):
        full_name = f"{FEMALE_NAMES[i % len(FEMALE_NAMES)]} {FAMILY_SURNAMES[i]}"
        existing_guardian = await db.scalar(
            select(Guardian).where(
                Guardian.organization_id == org_id, Guardian.full_name == full_name
            )
        )
        if existing_guardian is None:
            relation = GUARDIAN_RELATIONS[i % len(GUARDIAN_RELATIONS)]
            gender = "F" if relation in ("mother", "grandmother", "aunt") else "M"
            guardian = Guardian(
                organization_id=org_id,
                family_id=family.id,
                full_name=full_name,
                # national_id encrypted at rest (decrypt-on-read on staff endpoints).
                national_id_encrypted=encrypt_field(
                    _national_id(family.country_code or "PS", 900 + i)
                ),
                date_of_birth=date(1972 + (i % 18), 1 + (i % 12), 1 + (i % 27)),
                gender=gender,
                relation=relation,
                phone=f"+9655{i:07d}",
                whatsapp=f"+9655{i:07d}",
                literacy_level=rng.choice(LITERACY_LEVELS),
                preferred_communication=rng.choice(["whatsapp", "phone"]),
                status="active",
            )
            db.add(guardian)
            guardians.append(guardian)
        else:
            guardians.append(existing_guardian)
    await db.flush()
    summary.guardians = len(guardians)

    # ── Orphans (50) ───────────────────────────────────────────────────────────
    orphans: list[Orphan] = []
    used_first_names: dict[int, set[str]] = defaultdict(set)
    for i in range(TOTAL_ORPHANS):
        family_idx = i % len(families)
        family = families[family_idx]
        partner = partners[family_idx % len(partners)]
        country = partner.country_code
        gender = "M" if i % 2 == 0 else "F"
        pool = MALE_NAMES if gender == "M" else FEMALE_NAMES
        first_name = next(
            (
                pool[(i + k) % len(pool)]
                for k in range(len(pool))
                if pool[(i + k) % len(pool)] not in used_first_names[family_idx]
            ),
            pool[i % len(pool)],
        )
        used_first_names[family_idx].add(first_name)

        father_full = family_father[family_idx]
        middle_name = father_full.split(" ", 1)[0]
        age = 3 + (i % 15)  # 3 – 17
        dob = date(today.year - age, 1 + (i % 12), 1 + (i % 27))

        if age <= 4:
            education = "pre_kindergarten"
        elif age <= 5:
            education = "kindergarten"
        elif age <= 11:
            education = "primary"
        elif age <= 14:
            education = "preparatory"
        else:
            education = "secondary"

        # Vary national_id presence: documented countries + every other orphan.
        give_id = country in ("EG", "JO") or i % 2 == 0
        national_id = _national_id(country, i) if give_id else None

        code = ORPHAN_CODE.format(i + 1)
        orphan = await _get_orphan(db, code)
        if orphan is None:
            orphan = Orphan(
                organization_id=org_id,
                partner_organization_id=partner.id,
                family_id=family.id,
                code=code,
                first_name=first_name,
                middle_name=middle_name,
                family_name=FAMILY_SURNAMES[family_idx],
                full_name_en=f"Demo Orphan {i + 1:02d}",
                date_of_birth=dob,
                gender=gender,
                nationality=country,
                birth_certificate_number=f"BC-DEMO-{i + 1:04d}",
                father_name=father_full,
                father_death_date=family.father_death_date,
                father_death_certificate=f"DC-DEMO-{i + 1:04d}",
                mother_name=f"{FEMALE_NAMES[(i + 5) % len(FEMALE_NAMES)]} {FAMILY_SURNAMES[family_idx]}",
                lives_with=LIVES_WITH[i % len(LIVES_WITH)],
                education_stage=education,
                academic_level=ACADEMIC_LEVELS[i % len(ACADEMIC_LEVELS)],
                school_name=f"مدرسة {rng.choice(CITIES_BY_COUNTRY[country])} النموذجية",
                quran_juz_memorized=min(30, (age - 2) + (i % 4)),
                quran_note="يواظب على حلقة التحفيظ.",
                health_status=HEALTH_STATUSES[i % len(HEALTH_STATUSES)],
                health_coverage=HEALTH_COVERAGES[i % len(HEALTH_COVERAGES)],
                chronic_conditions="ربو خفيف" if i % 7 == 0 else None,
                aspiration=rng.choice(["طبيب", "مهندس", "معلّم", "طيّار", "مبرمج", "إعلامي"]),
                challenges="يحتاج إلى دعم في مادة الرياضيات." if i % 5 == 0 else None,
                tags=rng.sample(ORPHAN_TAGS, k=2),
                # national_id → Fernet ciphertext + deterministic blind index, the
                # exact write path the create endpoint uses (keeps the per-org
                # uniqueness guard and decrypt-on-read invariants intact).
                national_id_encrypted=encrypt_field(national_id) if national_id else None,
                national_id_blind_index=(
                    national_id_blind_index(national_id) if national_id else None
                ),
                country_specific={"intake": "demo", "source": "scripts.seed_demo"},
                mother_status=MOTHER_STATUSES[i % len(MOTHER_STATUSES)],
                priority_level=PRIORITY_LEVELS[i % len(PRIORITY_LEVELS)],
                case_status="pending_review",
                balance_currency="KWD",
                created_by=admin_id,
            )
            db.add(orphan)
        orphans.append(orphan)
    await db.flush()

    # ── Donors (12; 2 with portal logins) ──────────────────────────────────────
    donors: list[Donor] = []
    for i, fixture in enumerate(DONOR_FIXTURES):
        code = DONOR_CODE.format(i + 1)
        donor = await _get_donor(db, code)
        login = DONOR_LOGINS.get(i)
        donor_email = login["email"] if login else f"demo-donor-{i + 1:02d}@demo.rufaqaa.app"

        user_id: UUID | None = None
        if login is not None:
            donor_user = await _get_user(db, login["email"])
            if donor_user is None:
                donor_user = User(
                    organization_id=org_id,
                    email=login["email"],
                    password_hash=hash_password(login["password"]),
                    first_name=fixture["full_name"].split(" ", 1)[0],
                    last_name="(متبرع)",
                    role="donor",
                    language="ar",
                    status="active",
                    email_verified_at=now,
                )
                db.add(donor_user)
                await db.flush()
            user_id = donor_user.id
            summary.donor_logins += 1

        if donor is None:
            donor = Donor(
                organization_id=org_id,
                user_id=user_id,
                code=code,
                full_name=fixture["full_name"],
                email=donor_email,
                phone=f"+9659{i:07d}",
                nationality=fixture["country"],
                country_of_residence=fixture["country"],
                preferred_currency=fixture["currency"],
                kyc_status="not_required",
                is_zakat_donor=(i % 3 == 0),
                status="active",
            )
            db.add(donor)
        else:
            donor.user_id = user_id
        # Reset denormalised aggregates each run (recomputed from payments below).
        donor.total_sponsorships = 0
        donor.active_sponsorships = 0
        donor.total_donated = Decimal("0")
        donor.total_donated_currency = "KWD"  # aggregated in the org's default currency
        donor.first_donation_at = None
        donor.last_donation_at = None
        donors.append(donor)
    await db.flush()
    summary.donors = len(donors)

    # ── Sponsorships (35) ──────────────────────────────────────────────────────
    # Donor 0 (login) sponsors the first 6 orphans (rich published reports);
    # donor 4 (login) the next 4; the remaining 25 round-robin the other donors.
    other_donor_idx = [i for i in range(len(donors)) if i not in (0, 4)]
    sponsorships: list[Sponsorship] = []
    sponsored_orphans: list[Orphan] = []
    # Start-date spread (months ago): older for the rich-report donors.
    rich_start = [24, 22, 20, 18, 16, 15]
    for s in range(SPONSORED_ORPHANS):
        orphan = orphans[s]
        sponsored_orphans.append(orphan)
        if s < 6:
            donor = donors[0]
            months_ago = rich_start[s]
        elif s < 10:
            donor = donors[4]
            months_ago = 14 - (s - 6) * 2
        else:
            donor = donors[other_donor_idx[(s - 10) % len(other_donor_idx)]]
            months_ago = 3 + ((s * 7) % 18)

        preferred = donor.preferred_currency or "KWD"
        currency = preferred if preferred in ("KWD", "USD") else "KWD"
        amount = rng.choice(KWD_AMOUNTS if currency == "KWD" else USD_AMOUNTS)
        start_date = _add_months(today, -months_ago)

        # Status: keep the rich-report donors (0..9) fully active; sprinkle a
        # couple paused/overdue among the rest for realism — all still "sponsored".
        if 30 <= s <= 31:
            sp_status = "paused"
        elif 32 <= s <= 33:
            sp_status = "overdue"
        else:
            sp_status = "active"

        code = SPONSORSHIP_CODE.format(s + 1)
        sponsorship = await _get_sponsorship(db, code)
        if sponsorship is None:
            sponsorship = Sponsorship(
                organization_id=org_id,
                code=code,
                donor_id=donor.id,
                orphan_id=orphan.id,
                monthly_amount=amount,
                currency=currency,
                start_date=start_date,
                payment_frequency="monthly",
                payment_method=rng.choice(["knet", "credit_card", "bank_transfer"]),
                status=sp_status,
                acquisition_source=rng.choice(["website", "referral", "campaign"]),
                notes="كفالة تجريبية للعرض.",
                created_by=admin_id,
            )
            db.add(sponsorship)
        else:
            sponsorship.donor_id = donor.id
            sponsorship.monthly_amount = amount
            sponsorship.currency = currency
            sponsorship.start_date = start_date
            sponsorship.status = sp_status
        # Reset denormalised totals (recomputed from payments below).
        sponsorship.total_paid = Decimal("0")
        sponsorship.payments_count = 0
        sponsorship.last_payment_date = None
        sponsorship.last_payment_amount = None
        sponsorship.months_overdue = rng.randint(1, 3) if sp_status == "overdue" else 0
        sponsorships.append(sponsorship)

        # Reflect the active sponsorship on the orphan.
        orphan.is_sponsored = True
        orphan.case_status = "sponsored"
        orphan.current_balance = amount
        orphan.balance_currency = currency
    await db.flush()

    # Remaining orphans populate the un-sponsored pipeline.
    pipeline_statuses = ["available", "pending_review", "reserved"]
    for j, orphan in enumerate(orphans[SPONSORED_ORPHANS:]):
        orphan.is_sponsored = False
        orphan.current_balance = Decimal("0")
        status_value = pipeline_statuses[j % len(pipeline_statuses)]
        orphan.case_status = status_value
        if status_value == "available":
            stamp_available_since(orphan)

    for orphan in orphans:
        recompute_profile_completion(orphan)
        summary.orphans_by_status[orphan.case_status] += 1

    # ── Payments (full monthly history per sponsorship) ────────────────────────
    payment_seq = 0
    receipt_seq = 0
    for s, sponsorship in enumerate(sponsorships):
        n_months = _months_between(sponsorship.start_date, today)
        donor = next(d for d in donors if d.id == sponsorship.donor_id)
        completed_total = Decimal("0")
        n_completed = 0
        last_completed: date | None = None
        for m in range(n_months + 1):
            pay_date = _add_months(sponsorship.start_date, m)
            if pay_date > today:
                break
            payment_seq += 1
            receipt_seq += 1
            completed_at = datetime(
                pay_date.year, pay_date.month, min(pay_date.day, 28), 12, tzinfo=UTC
            )
            amount = sponsorship.monthly_amount
            if sponsorship.currency == "USD":
                rate = USD_TO_KWD
                default_amount = (amount * rate).quantize(Decimal("0.01"), ROUND_HALF_UP)
            else:
                rate = Decimal("1")
                default_amount = amount
            db.add(
                Payment(
                    organization_id=org_id,
                    code=PAYMENT_CODE.format(payment_seq),
                    donor_id=donor.id,
                    sponsorship_id=sponsorship.id,
                    orphan_id=sponsorship.orphan_id,
                    amount=amount,
                    currency=sponsorship.currency,
                    amount_in_default_currency=default_amount,
                    exchange_rate=rate,
                    payment_method=sponsorship.payment_method or "knet",
                    payment_gateway="myfatoorah" if sponsorship.payment_method == "knet" else None,
                    status="completed",
                    initiated_at=completed_at,
                    processed_at=completed_at,
                    completed_at=completed_at,
                    receipt_number=RECEIPT_NUMBER.format(receipt_seq),
                    receipt_issued_at=completed_at,
                    source_type="sponsorship",
                    payment_metadata={"demo": True, "month": pay_date.isoformat()},
                    created_by=admin_id,
                )
            )
            summary.payments_by_status["completed"] += 1
            completed_total += amount
            n_completed += 1
            last_completed = pay_date
            if donor.first_donation_at is None or completed_at < donor.first_donation_at:
                donor.first_donation_at = completed_at
            if donor.last_donation_at is None or completed_at > donor.last_donation_at:
                donor.last_donation_at = completed_at
            donor.total_donated = (donor.total_donated or Decimal("0")) + default_amount

        sponsorship.total_paid = completed_total
        sponsorship.payments_count = n_completed
        sponsorship.last_payment_date = last_completed
        sponsorship.last_payment_amount = sponsorship.monthly_amount if last_completed else None
        if sponsorship.status == "active" and last_completed is not None:
            sponsorship.next_payment_date = _add_months(last_completed, 1)
        elif sponsorship.status == "overdue":
            sponsorship.next_payment_date = _add_months(today, -sponsorship.months_overdue)

        # A couple of non-completed payments for realism (one pending, one failed).
        if s == 10 or s == 11:
            payment_seq += 1
            pending = s == 10
            db.add(
                Payment(
                    organization_id=org_id,
                    code=PAYMENT_CODE.format(payment_seq),
                    donor_id=donor.id,
                    sponsorship_id=sponsorship.id,
                    orphan_id=sponsorship.orphan_id,
                    amount=sponsorship.monthly_amount,
                    currency=sponsorship.currency,
                    payment_method=sponsorship.payment_method or "knet",
                    status="pending" if pending else "failed",
                    initiated_at=now,
                    failed_at=None if pending else now,
                    failure_reason=None if pending else "بطاقة مرفوضة",
                    source_type="sponsorship",
                    payment_metadata={"demo": True},
                    created_by=admin_id,
                )
            )
            summary.payments_by_status["pending" if pending else "failed"] += 1

    # Donor sponsorship counts.
    for donor in donors:
        donor_sponsorships = [sp for sp in sponsorships if sp.donor_id == donor.id]
        donor.total_sponsorships = len(donor_sponsorships)
        donor.active_sponsorships = sum(1 for sp in donor_sponsorships if sp.status == "active")

    # ── Documents (3–5 sample documents per orphan) ────────────────────────────
    for i, orphan in enumerate(orphans):
        for d in range(3 + (i % 3)):  # 3–5
            doc_type = DOCUMENT_TYPES[(i + d) % len(DOCUMENT_TYPES)]
            db.add(
                Document(
                    organization_id=org_id,
                    orphan_id=orphan.id,
                    family_id=orphan.family_id,
                    document_type=doc_type,
                    title=f"{doc_type} (عينة) — {orphan.first_name}",
                    description="مستند تجريبي — ليس وثيقة حقيقية.",
                    file_url=assets.document_url,
                    file_name=assets.document_name,
                    file_mime_type=assets.document_mime,
                    file_size_bytes=len(_sample_document_svg()),
                    storage_provider="s3",
                    verification_status=VERIFICATION_STATUSES[(i + d) % len(VERIFICATION_STATUSES)],
                    is_encrypted=False,
                    uploaded_by=admin_id,
                )
            )
            summary.documents += 1

    # ── Gender-based profile photo (one donor-visible media per orphan) ────────
    for orphan in orphans:
        await _insert_media(
            db,
            org_id=org_id,
            orphan_id=orphan.id,
            report_id=None,
            file_url=assets.photo_by_gender[orphan.gender],
            title=f"الصورة الشخصية — {orphan.first_name}",
            uploaded_by=admin_id,
            created_at=now - timedelta(days=rng.randint(10, 120)),
        )
        summary.media += 1

    # ── Orphan reports (3–6 per sponsored orphan) + report media ───────────────
    for idx, orphan in enumerate(sponsored_orphans):
        rich = idx < 6  # donor 0's orphans get the most, mostly published
        n_reports = rng.randint(5, 6) if rich else rng.randint(3, 4)
        for r in range(n_reports):
            months_ago = r + 1
            period_start, period_end = _month_window(months_ago, today)
            period_label = f"{period_start.year}-{period_start.month:02d}"
            report_type = "quarterly" if r % 3 == 2 else "monthly"
            content = _report_content(orphan, period_label, rng)

            # Most recent report stays in the approval workflow (draft / pending);
            # everything older is published to the donor.
            if r == 0:
                status_value = "draft" if idx % 2 == 0 else "pending_partner_approval"
            else:
                status_value = "published_to_donor"

            submitted_at = now - timedelta(days=months_ago * 30 - 5)
            partner_approved_at: datetime | None = None
            org_approved_at: datetime | None = None
            published_at: datetime | None = None
            if status_value == "published_to_donor":
                partner_approved_at = submitted_at + timedelta(days=2)
                org_approved_at = submitted_at + timedelta(days=3)
                published_at = submitted_at + timedelta(days=4)
            elif status_value == "draft":
                submitted_at = now  # drafts are not really "submitted"

            n_media = rng.randint(1, 3) if status_value == "published_to_donor" else 0
            report = OrphanReport(
                organization_id=org_id,
                orphan_id=orphan.id,
                report_type=report_type,
                period_start=period_start,
                period_end=period_end,
                educational_progress=content["educational_progress"],
                quran_progress=content["quran_progress"],
                activities=content["activities"],
                health_status=content["health_status"],
                psychological_status=content["psychological_status"],
                summary=content["summary"],
                photos_count=n_media,
                status=status_value,
                submitted_by=admin_id if status_value != "draft" else None,
                submitted_at=submitted_at if status_value != "draft" else None,
                partner_approved_by=admin_id if partner_approved_at else None,
                partner_approved_at=partner_approved_at,
                org_approved_by=admin_id if org_approved_at else None,
                org_approved_at=org_approved_at,
                published_at=published_at,
                donors_notified_at=published_at,
            )
            db.add(report)
            summary.reports_by_status[status_value] += 1
            await db.flush()  # need report.id for its media

            # Donor-only sample media attached to each published report.
            for _m in range(n_media):
                await _insert_media(
                    db,
                    org_id=org_id,
                    orphan_id=orphan.id,
                    report_id=report.id,
                    file_url=assets.photo_by_gender[orphan.gender],
                    title=f"صورة من تقرير {period_label} — {orphan.first_name}",
                    uploaded_by=admin_id,
                    created_at=published_at or now,
                )
                summary.media += 1

    await db.commit()
    return summary


async def _insert_media(
    db: AsyncSession,
    *,
    org_id: UUID,
    orphan_id: UUID,
    report_id: UUID | None,
    file_url: str,
    title: str,
    uploaded_by: UUID,
    created_at: datetime,
) -> None:
    """Insert one approved, donor-visible, consent-flagged media row.

    ``media`` has no ORM model, so — like the app's own upload path — this uses
    a parameterised INSERT. visibility='donor_only' + moderation_status='approved'
    is exactly what makes a photo visible to the sponsoring donor.
    """
    await db.execute(
        text(
            """
            INSERT INTO media
                (id, organization_id, orphan_id, report_id, media_type,
                 title, file_url, file_size_bytes,
                 moderation_status, moderated_by, moderated_at,
                 visibility, has_guardian_consent, uploaded_by, created_at)
            VALUES
                (:id, :org, :orphan, :report, 'photo',
                 :title, :url, :size,
                 'approved', :moderator, :created,
                 'donor_only', TRUE, :uploader, :created)
            """
        ),
        {
            "id": str(uuid4()),
            "org": str(org_id),
            "orphan": str(orphan_id),
            "report": str(report_id) if report_id else None,
            "title": title,
            "url": file_url,
            "size": 12000,
            "moderator": str(uploaded_by),
            "uploader": str(uploaded_by),
            "created": created_at,
        },
    )


# ── Purge ─────────────────────────────────────────────────────────────────────
async def _purge() -> None:
    """Delete ONLY the seeded rows — everything scoped to the demo org — in
    FK-safe order (children first), then the org itself."""
    async with make_session() as db:
        org = await db.scalar(select(Organization).where(Organization.code == ORG_CODE))
        if org is None:
            print(f"✔ nothing to purge — no organisation with code {ORG_CODE!r}.")
            return
        org_id = org.id
        await db.execute(text("DELETE FROM media WHERE organization_id = :o"), {"o": str(org_id)})
        await db.execute(delete(OrphanReport).where(OrphanReport.organization_id == org_id))
        await db.execute(delete(Document).where(Document.organization_id == org_id))
        await db.execute(delete(Payment).where(Payment.organization_id == org_id))
        await db.execute(delete(Sponsorship).where(Sponsorship.organization_id == org_id))
        await db.execute(delete(Orphan).where(Orphan.organization_id == org_id))
        await db.execute(delete(Guardian).where(Guardian.organization_id == org_id))
        await db.execute(delete(Family).where(Family.organization_id == org_id))
        await db.execute(delete(Donor).where(Donor.organization_id == org_id))
        await db.execute(
            text("DELETE FROM business_rules WHERE organization_id = :o"), {"o": str(org_id)}
        )
        await db.execute(
            delete(PartnerOrganization).where(PartnerOrganization.organization_id == org_id)
        )
        await db.execute(delete(User).where(User.organization_id == org_id))
        await db.execute(delete(Organization).where(Organization.id == org_id))
        await db.commit()
    print(f"✔ purged every demo row for org {ORG_CODE!r} (id {org_id}).")
    print("  (shared MinIO objects under demo/ are left in place — storage GC is out of band.)")


# ── Reporting ─────────────────────────────────────────────────────────────────
def _print_summary(summary: Summary) -> None:
    print("\n" + "═" * 64)
    print("✔ DEMO SEED COMPLETE")
    print("═" * 64)
    print(f"  organisation : {ORG_NAME_EN} ({ORG_CODE})  id={summary.org_id}")
    print(f"  partners     : {summary.partners}")
    print(f"  families     : {summary.families}    guardians: {summary.guardians}")
    orphans_total = sum(summary.orphans_by_status.values())
    print(f"  orphans      : {orphans_total}")
    for status_value, count in sorted(summary.orphans_by_status.items()):
        print(f"      - {status_value:<14}: {count}")
    print(f"  donors       : {summary.donors}  ({summary.donor_logins} with portal logins)")
    print(f"  sponsorships : {sum(summary.sponsorships_by_status.values())}")
    for status_value, count in sorted(summary.sponsorships_by_status.items()):
        print(f"      - {status_value:<14}: {count}")
    print(f"  payments     : {sum(summary.payments_by_status.values())}")
    for status_value, count in sorted(summary.payments_by_status.items()):
        print(f"      - {status_value:<14}: {count}")
    print(f"  reports      : {sum(summary.reports_by_status.values())}")
    for status_value, count in sorted(summary.reports_by_status.items()):
        print(f"      - {status_value:<22}: {count}")
    print(f"  documents    : {summary.documents}")
    print(f"  media        : {summary.media}")

    print("\n  Demo logins (clearly fake — local/dev only):")
    print(f"    staff/admin : {STAFF_LOGIN['email']} / {STAFF_LOGIN['password']}")
    for idx, login in DONOR_LOGINS.items():
        tag = " (sponsors several orphans with rich published reports)" if idx == 0 else ""
        print(f"    donor       : {login['email']} / {login['password']}{tag}")
    print("═" * 64)


async def _run_seed() -> None:
    assets = await _upload_shared_assets()
    async with make_session() as db:
        summary = await _seed(db, assets)
    # Sponsorship status breakdown (computed from the DB after commit for accuracy).
    async with make_session() as db:
        org = await db.scalar(select(Organization).where(Organization.code == ORG_CODE))
        if org is not None:
            rows = (
                await db.execute(
                    select(Sponsorship.status, func.count())
                    .where(Sponsorship.organization_id == org.id)
                    .group_by(Sponsorship.status)
                )
            ).all()
            for status_value, count in rows:
                summary.sponsorships_by_status[str(status_value)] = int(count)
    _print_summary(summary)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.seed_demo",
        description="Re-runnable demo seed for the local dev environment.",
    )
    parser.add_argument(
        "--purge",
        action="store_true",
        help="delete ONLY the seeded rows (everything scoped to the demo org), then exit",
    )
    args = parser.parse_args()

    _assert_local_dev()

    if args.purge:
        asyncio.run(_purge())
    else:
        asyncio.run(_run_seed())


if __name__ == "__main__":
    main()
