"""Cross-tenant (multi-tenant) isolation for the "surface" routers.

The app connects to Postgres as a SUPERUSER, which BYPASSES Row-Level
Security, so every query over tenant-owned data must filter by
``organization_id`` EXPLICITLY in code. These tests stand up two
organizations and prove that an org-A caller can neither list nor reach
org-B rows across the Phase 4 surfaces — messages, documents, marketing
channels, reports and the dashboard stats: lists show only A, every
fetch/mutation of a B row returns 404 (never 403/200, so a row's existence
is never leaked), and the dashboard aggregates count only A's data. A
positive in-org baseline guards against a blanket break being mistaken for
isolation.

These mirror :mod:`tests.integration.test_tenant_isolation` (families /
partners), :mod:`tests.integration.test_tenant_isolation_orphans`,
:mod:`tests.integration.test_tenant_isolation_finance` and
:mod:`tests.integration.test_tenant_isolation_accounts`, and like the rest of
``tests/integration`` need a real Postgres with the migrations applied
(``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip. Rows are inserted
directly via the ORM, and every cross-org assertion is reached before any
ownership/state check — the org guard fires first.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from httpx import AsyncClient

from app.core.database import make_session
from app.core.security import hash_password
from app.models.document import Document
from app.models.donor import Donor
from app.models.family import Guardian
from app.models.message import Message
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import MarketingChannel, PartnerOrganization
from app.models.payment import Payment
from app.models.report import OrphanReport
from app.models.sponsorship import Sponsorship
from app.models.user import User

# ── Fixtures (direct ORM inserts) ─────────────────────────────────────────


async def _make_org() -> UUID:
    """Create a fresh, isolated organization and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        org = Organization(
            code=f"TIS-{suffix[:6].upper()}",
            name_ar="منظمة",
            name_en="Tenant Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)
        return org.id


async def _make_partner(org_id: UUID) -> UUID:
    """Create a جهة (partner org) in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        partner = PartnerOrganization(
            organization_id=org_id,
            code=f"PTN-{suffix}",
            name_ar=f"جهة-{suffix}",
            country_code="KW",
            status="active",
        )
        db.add(partner)
        await db.commit()
        await db.refresh(partner)
        return partner.id


async def _make_orphan(org_id: UUID, partner_id: UUID) -> UUID:
    """Create an orphan in ``org_id``/``partner_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        orphan = Orphan(
            organization_id=org_id,
            partner_organization_id=partner_id,
            code=f"ORF-{suffix}",
            first_name=f"يتيم-{suffix}",
            family_name="سطح",
            date_of_birth=date(2015, 3, 14),
            gender="M",
        )
        db.add(orphan)
        await db.commit()
        await db.refresh(orphan)
        return orphan.id


async def _make_donor(org_id: UUID) -> UUID:
    """Create a donor in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        donor = Donor(
            organization_id=org_id,
            code=f"DON-{suffix}",
            full_name=f"متبرع-{suffix}",
            email=f"donor-{suffix}@dev.example.com",
        )
        db.add(donor)
        await db.commit()
        await db.refresh(donor)
        return donor.id


async def _make_sponsorship(org_id: UUID, donor_id: UUID, orphan_id: UUID) -> UUID:
    """Create an active sponsorship in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        sp = Sponsorship(
            organization_id=org_id,
            code=f"KAF-{suffix}",
            donor_id=donor_id,
            orphan_id=orphan_id,
            monthly_amount=Decimal("25.00"),
            currency="KWD",
            start_date=date(2024, 1, 1),
            status="active",
        )
        db.add(sp)
        await db.commit()
        await db.refresh(sp)
        return sp.id


async def _make_payment(org_id: UUID, donor_id: UUID, orphan_id: UUID, amount: str) -> UUID:
    """Create a completed payment in ``org_id`` (linked to ``orphan_id``)."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        payment = Payment(
            organization_id=org_id,
            code=f"PAY-{suffix}",
            donor_id=donor_id,
            orphan_id=orphan_id,
            amount=Decimal(amount),
            currency="KWD",
            payment_method="cash",
            status="completed",
            completed_at=datetime.now(UTC),
        )
        db.add(payment)
        await db.commit()
        await db.refresh(payment)
        return payment.id


async def _make_guardian(org_id: UUID) -> UUID:
    """Create a guardian in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        guardian = Guardian(
            organization_id=org_id,
            full_name=f"ولي-{suffix}",
            relation="mother",
        )
        db.add(guardian)
        await db.commit()
        await db.refresh(guardian)
        return guardian.id


async def _make_document(
    org_id: UUID, *, orphan_id: UUID | None = None, guardian_id: UUID | None = None
) -> UUID:
    """Create a document in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        doc = Document(
            organization_id=org_id,
            orphan_id=orphan_id,
            guardian_id=guardian_id,
            document_type="other",
            title=f"وثيقة-{suffix}",
            file_url=f"https://example.com/{suffix}.pdf",
            verification_status="pending",
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
        return doc.id


async def _make_channel(org_id: UUID) -> UUID:
    """Create an active marketing channel in ``org_id`` and return its id."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        channel = MarketingChannel(
            organization_id=org_id,
            name_ar=f"قناة-{suffix}",
            name_en=f"Channel {suffix}",
            channel_type="committee",
            status="active",
        )
        db.add(channel)
        await db.commit()
        await db.refresh(channel)
        return channel.id


async def _make_report(org_id: UUID, orphan_id: UUID) -> UUID:
    """Create a draft report in ``org_id`` for ``orphan_id`` and return its id."""
    async with make_session() as db:
        report = OrphanReport(
            organization_id=org_id,
            orphan_id=orphan_id,
            report_type="monthly",
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
            status="draft",
        )
        db.add(report)
        await db.commit()
        await db.refresh(report)
        return report.id


async def _make_message(
    org_id: UUID,
    from_user_id: UUID,
    to_user_id: UUID,
    orphan_id: UUID,
    *,
    moderation_status: str = "approved",
) -> UUID:
    """Create a message in ``org_id`` and return its id."""
    async with make_session() as db:
        msg = Message(
            organization_id=org_id,
            from_user_id=from_user_id,
            to_user_id=to_user_id,
            related_orphan_id=orphan_id,
            message_type="text",
            content="مرحبا",
            moderation_status=moderation_status,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg.id


async def _make_user(org_id: UUID, role: str) -> UUID:
    """Create a user with ``role`` in ``org_id`` (no login) and return its id."""
    suffix = uuid.uuid4().hex[:8]
    async with make_session() as db:
        user = User(
            organization_id=org_id,
            email=f"{role[:3]}-{suffix}@dev.example.com",
            password_hash=hash_password("tenantpw123456"),
            first_name="Tenant",
            last_name="User",
            role=role,
            status="active",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user.id


async def _login_as(api: AsyncClient, org_id: UUID, role: str) -> tuple[UUID, dict[str, str]]:
    """Create a user with ``role`` in ``org_id``, log in, return (id, auth headers)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@dev.example.com"
    password = "tenantpw123456"
    async with make_session() as db:
        user = User(
            organization_id=org_id,
            email=email,
            password_hash=hash_password(password),
            first_name="Tenant",
            last_name="User",
            role=role,
            status="active",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_id = user.id
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return user_id, {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── Tests ──────────────────────────────────────────────────────────────


async def test_messages_cross_tenant_isolation(api: AsyncClient) -> None:
    """A moderator sees only its org's messages; cross-org fetch/read/send/moderate 404."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a = await _make_orphan(org_a, partner_a)
    orphan_b = await _make_orphan(org_b, partner_b)

    # donor_a sends; recipient_a receives. B mirrors with its own users.
    donor_a, donor_a_headers = await _login_as(api, org_a, "donor")
    recipient_a = await _make_user(org_a, "guardian")
    sender_b = await _make_user(org_b, "donor")
    recipient_b = await _make_user(org_b, "guardian")

    msg_a = await _make_message(org_a, donor_a, recipient_a, orphan_a, moderation_status="approved")
    msg_a_pending = await _make_message(
        org_a, donor_a, recipient_a, orphan_a, moderation_status="pending"
    )
    msg_b = await _make_message(
        org_b, sender_b, recipient_b, orphan_b, moderation_status="approved"
    )
    msg_b_pending = await _make_message(
        org_b, sender_b, recipient_b, orphan_b, moderation_status="pending"
    )

    _, headers_a = await _login_as(api, org_a, "org_admin")  # a message moderator

    # List (moderator view) is org-scoped: only org A's two messages, never B's.
    r = await api.get("/api/v1/messages?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {m["id"] for m in r.json()["items"]} == {str(msg_a), str(msg_a_pending)}

    # Moderation queue is org-scoped: only org A's pending message, never B's.
    r = await api.get("/api/v1/messages/pending?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {m["id"] for m in r.json()["items"]} == {str(msg_a_pending)}

    # Baseline: org A reaches its own message, so the 404s below are org scope.
    r = await api.get(f"/api/v1/messages/{msg_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    # Cross-org fetch + mark-read 404 — never 200/403, never leaking existence.
    r = await api.get(f"/api/v1/messages/{msg_b}", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/messages/{msg_b}/read", headers=headers_a)
    assert r.status_code == 404, r.text

    # Moderation (MESSAGE_MODERATOR_ROLES). Baseline: org A moderates its own
    # pending message. A cross-org pending message 404s on the org guard, before
    # the status check — so another org's message is never moderated.
    r = await api.post(
        f"/api/v1/messages/{msg_a_pending}/moderate",
        json={"decision": "approve"},
        headers=headers_a,
    )
    assert r.status_code == 200, r.text
    r = await api.post(
        f"/api/v1/messages/{msg_b_pending}/moderate",
        json={"decision": "approve"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text

    # send_message: baseline same-org send succeeds, so the cross-org 404s below
    # are org scope and not a blanket break.
    base_msg = {"content": "مرحبا", "message_type": "text"}
    r = await api.post(
        "/api/v1/messages",
        json={**base_msg, "to_user_id": str(recipient_a), "related_orphan_id": str(orphan_a)},
        headers=donor_a_headers,
    )
    assert r.status_code == 201, r.text

    # A cross-org recipient 404s (orphan is in-org, so only the recipient differs).
    r = await api.post(
        "/api/v1/messages",
        json={**base_msg, "to_user_id": str(recipient_b), "related_orphan_id": str(orphan_a)},
        headers=donor_a_headers,
    )
    assert r.status_code == 404, r.text

    # A cross-org orphan 404s (recipient is in-org, so only the orphan differs).
    r = await api.post(
        "/api/v1/messages",
        json={**base_msg, "to_user_id": str(recipient_a), "related_orphan_id": str(orphan_b)},
        headers=donor_a_headers,
    )
    assert r.status_code == 404, r.text


async def test_documents_cross_tenant_isolation(api: AsyncClient) -> None:
    """Document lists scope to an in-org parent; cross-org verify/delete/attach 404."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a = await _make_orphan(org_a, partner_a)
    orphan_b = await _make_orphan(org_b, partner_b)
    guardian_a = await _make_guardian(org_a)
    guardian_b = await _make_guardian(org_b)

    doc_orphan_a = await _make_document(org_a, orphan_id=orphan_a)
    await _make_document(org_b, orphan_id=orphan_b)
    doc_guardian_a = await _make_document(org_a, guardian_id=guardian_a)
    await _make_document(org_b, guardian_id=guardian_b)
    doc_a = await _make_document(org_a)  # standalone, for the verify baseline
    doc_b = await _make_document(org_b)  # standalone in B, for cross-org 404s

    _, headers_a = await _login_as(api, org_a, "org_admin")

    # Orphan-document list: in-org orphan returns only its own docs; a cross-org
    # orphan_id 404s on the parent fetch before any document is read.
    r = await api.get(f"/api/v1/orphans/{orphan_a}/documents", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {d["id"] for d in r.json()["items"]} == {str(doc_orphan_a)}
    r = await api.get(f"/api/v1/orphans/{orphan_b}/documents", headers=headers_a)
    assert r.status_code == 404, r.text

    # Guardian-document list: same shape.
    r = await api.get(f"/api/v1/guardians/{guardian_a}/documents", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {d["id"] for d in r.json()["items"]} == {str(doc_guardian_a)}
    r = await api.get(f"/api/v1/guardians/{guardian_b}/documents", headers=headers_a)
    assert r.status_code == 404, r.text

    # Baseline: org A verifies its own document, so the cross-org 404s are org scope.
    r = await api.post(
        f"/api/v1/documents/{doc_a}/verify",
        json={"status": "verified", "notes": "ok"},
        headers=headers_a,
    )
    assert r.status_code == 200, r.text

    # Cross-org verify + delete 404 — never 200/403.
    r = await api.post(
        f"/api/v1/documents/{doc_b}/verify",
        json={"status": "verified"},
        headers=headers_a,
    )
    assert r.status_code == 404, r.text
    r = await api.delete(f"/api/v1/documents/{doc_b}", headers=headers_a)
    assert r.status_code == 404, r.text

    # attach_document_to_orphan / attach_document_to_guardian (write holes):
    # baseline same-org attach succeeds; a cross-org parent 404s, so a document
    # can't be attached to another org's orphan/guardian.
    doc_payload = {"document_type": "other", "file_url": "https://example.com/new.pdf"}
    r = await api.post(f"/api/v1/orphans/{orphan_a}/documents", json=doc_payload, headers=headers_a)
    assert r.status_code == 201, r.text
    r = await api.post(
        f"/api/v1/guardians/{guardian_a}/documents", json=doc_payload, headers=headers_a
    )
    assert r.status_code == 201, r.text
    r = await api.post(f"/api/v1/orphans/{orphan_b}/documents", json=doc_payload, headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(
        f"/api/v1/guardians/{guardian_b}/documents", json=doc_payload, headers=headers_a
    )
    assert r.status_code == 404, r.text


async def test_marketing_channels_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A admin lists only org A's channels and 404s on every org-B channel."""
    org_a = await _make_org()
    org_b = await _make_org()
    channel_a = await _make_channel(org_a)
    channel_b = await _make_channel(org_b)

    _, headers_a = await _login_as(api, org_a, "org_admin")

    # List is org-scoped: only org A's channel, never B's.
    r = await api.get("/api/v1/marketing-channels?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {c["id"] for c in r.json()["items"]} == {str(channel_a)}

    # Baseline: org A reaches its own channel, so the 404s below are org scope.
    r = await api.get(f"/api/v1/marketing-channels/{channel_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    # Every cross-org fetch/mutation 404s — never 200/403.
    r = await api.get(f"/api/v1/marketing-channels/{channel_b}", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.patch(
        f"/api/v1/marketing-channels/{channel_b}", json={"name_en": "hijack"}, headers=headers_a
    )
    assert r.status_code == 404, r.text
    r = await api.delete(f"/api/v1/marketing-channels/{channel_b}", headers=headers_a)
    assert r.status_code == 404, r.text


async def test_reports_cross_tenant_isolation(api: AsyncClient) -> None:
    """An org-A reviewer lists only org A's reports and 404s on every org-B report."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a = await _make_orphan(org_a, partner_a)
    orphan_b = await _make_orphan(org_b, partner_b)
    report_a = await _make_report(org_a, orphan_a)
    report_b = await _make_report(org_b, orphan_b)

    _, headers_a = await _login_as(api, org_a, "org_admin")  # a report reviewer

    # List is org-scoped: only org A's report, never B's.
    r = await api.get("/api/v1/reports?limit=100", headers=headers_a)
    assert r.status_code == 200, r.text
    assert {rep["id"] for rep in r.json()["items"]} == {str(report_a)}

    # Baseline: org A reaches its own report, so the 404s below are org scope.
    r = await api.get(f"/api/v1/reports/{report_a}", headers=headers_a)
    assert r.status_code == 200, r.text

    # Cross-org fetch + content mutation 404.
    r = await api.get(f"/api/v1/reports/{report_b}", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.patch(
        f"/api/v1/reports/{report_b}", json={"summary": "tamper"}, headers=headers_a
    )
    assert r.status_code == 404, r.text

    # Every cross-org workflow transition 404s — the org guard fires before the
    # status check, so report_b's `draft` state is never consulted.
    r = await api.post(f"/api/v1/reports/{report_b}/submit", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/reports/{report_b}/approve-partner", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/reports/{report_b}/approve-org", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(f"/api/v1/reports/{report_b}/publish", headers=headers_a)
    assert r.status_code == 404, r.text
    r = await api.post(
        f"/api/v1/reports/{report_b}/reject", json={"reason": "tamper"}, headers=headers_a
    )
    assert r.status_code == 404, r.text


async def test_stats_cross_tenant_isolation(api: AsyncClient) -> None:
    """Dashboard aggregates count only the caller-org's rows, never another org's."""
    org_a = await _make_org()
    org_b = await _make_org()
    partner_a = await _make_partner(org_a)
    partner_b = await _make_partner(org_b)
    orphan_a = await _make_orphan(org_a, partner_a)
    orphan_b = await _make_orphan(org_b, partner_b)
    donor_a = await _make_donor(org_a)
    donor_b = await _make_donor(org_b)
    await _make_sponsorship(org_a, donor_a, orphan_a)
    await _make_sponsorship(org_b, donor_b, orphan_b)
    # Distinct amounts so a cross-org leak would change the totals visibly.
    await _make_payment(org_a, donor_a, orphan_a, "25.00")
    await _make_payment(org_b, donor_b, orphan_b, "99.00")

    _, headers_a = await _login_as(api, org_a, "org_admin")

    # summary counts only org A's single orphan/donor/sponsorship/payment.
    r = await api.get("/api/v1/stats/summary", headers=headers_a)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["orphans_total"] == 1
    assert data["donors_total"] == 1
    assert data["sponsorships_active"] == 1
    assert data["payments_last_30d_count"] == 1
    assert Decimal(str(data["payments_last_30d_total"])) == Decimal("25.00")

    # payments timeseries sums only org A's payment.
    r = await api.get("/api/v1/stats/payments-timeseries", headers=headers_a)
    assert r.status_code == 200, r.text
    months = r.json()["months"]
    assert sum(m["payments_count"] for m in months) == 1
    assert sum(Decimal(str(m["payments_total"])) for m in months) == Decimal("25.00")

    # sponsorships-by-status sees only org A's one active sponsorship.
    r = await api.get("/api/v1/stats/sponsorships-by-status", headers=headers_a)
    assert r.status_code == 200, r.text
    assert r.json()["slices"] == [{"status": "active", "count": 1}]

    # donations-by-partner rolls up only org A's partner, never org B's.
    r = await api.get("/api/v1/stats/donations-by-partner", headers=headers_a)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert {i["partner_id"] for i in items} == {str(partner_a)}
    assert Decimal(str(items[0]["payments_total"])) == Decimal("25.00")
