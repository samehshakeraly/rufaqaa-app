"""R7 — wishes + needs entities + entity-linked donation MODEL (no payment execution).

TWO new per-orphan tables (migration 0031) with staff CRUD and gated donor
blocks, plus the nullable ``payments.target_type``/``target_id`` columns that
let a FUTURE one-time donation point at a wish/need (R8 wires the money).
Exercised here:

* staff CRUD round-trip for both entities — create / list / patch / delete,
  including the staff-only ``internal_note`` and the controlled coded
  ``status`` transition (the ONLY lifecycle surface);
* ``raised_amount`` is SYSTEM-managed and IMMUTABLE in R7: no create or patch
  accepts it (422 via ``extra="forbid"``) and nothing moves it off 0;
* every wishes/needs query is EXPLICITLY org-scoped (the app's superuser
  connection bypasses RLS): a cross-org orphan id 404s on create, PATCH/DELETE
  on another org's row 404s, and even a corrupted foreign-org row pointing at
  OUR orphan never surfaces on the staff list or the donor blocks;
* the donor profile carries the ``wishes``/``needs`` blocks ONLY when the
  element is visible AND at least one NON-ARCHIVED item exists; archived rows
  are excluded server-side; each card is EXACTLY the allowlist plus a correct
  derived ``progress``;
* the staff-only ``internal_note`` (and every id / timestamp) NEVER appears
  anywhere in the donor payload;
* both elements register in the staff GET/PUT visibility registry;
* the new ``payments`` columns are nullable and existing payment creation is
  entirely unchanged (both stay NULL);
* ``PublicOrphanDetail`` (the pre-sponsorship public card) stays untouched;
* migration 0031 is fully reversible (downgrade drops the payments columns and
  both tables; upgrade recreates everything).

Like the rest of ``tests/integration`` these need a real Postgres with the
migrations applied (``RUFAQAA_TEST_DATABASE_URL``); otherwise they skip.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session
from app.models.need import OrphanNeed
from app.models.organization import Organization
from app.models.orphan import Orphan
from app.models.partner import PartnerOrganization
from app.models.wish import OrphanWish

# The donor cards are EXACTLY these minimal slices — nothing may ever be
# added without a deliberate privacy review.
_WISH_CARD_KEYS = {
    "title",
    "description",
    "target_amount",
    "currency",
    "raised_amount",
    "status",
    "progress",
}
_NEED_CARD_KEYS = _WISH_CARD_KEYS | {"category"}

# Distinctive staff-only note values, planted so a leak is caught even under
# a renamed key.
_PLANTED_WISH_NOTE = "ملاحظة-الأمنية-السرية-R7"
_PLANTED_NEED_NOTE = "ملاحظة-الاحتياج-السرية-R7"


# ── Fixtures / helpers ─────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _make_orphan(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str, **extra: Any
) -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    body = {
        "first_name": f"r7-{suffix}",
        "family_name": "عائلة-الأمنيات",
        "date_of_birth": "2014-03-01",
        "gender": "F",
        "nationality": "KW",
        "father_name": "أب-الأمنيات",
        "partner_organization_id": partner_id,
        **extra,
    }
    r = await api.post("/api/v1/orphans", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _signup_donor(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    """Create an org donor + a linked, logged-in donor user; return
    (donor_id, donor_auth_headers)."""
    suffix = uuid.uuid4().hex[:8]
    email = f"r7-{suffix}@example.com"
    password = "longenoughpw1"

    donor_id = str(
        (
            await api.post(
                "/api/v1/donors",
                json={"full_name": f"Donor {suffix}", "email": email},
                headers=admin_headers,
            )
        ).json()["id"]
    )
    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "Test", "last_name": "Donor", "role": "donor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = str(r.json()["user"]["id"])
    await api.post(
        "/api/v1/users/accept-invite", json={"token": invite_token, "password": password}
    )

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()
    return donor_id, headers


async def _make_sponsorship(
    api: AsyncClient, admin_headers: dict[str, str], donor_id: str, orphan_id: str
) -> str:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "10.00",
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _sponsored_profile(
    api: AsyncClient, donor_headers: dict[str, str], orphan_id: str
) -> dict[str, Any]:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=donor_headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def _create_wish(
    api: AsyncClient, admin_headers: dict[str, str], orphan_id: str, **body: Any
) -> dict[str, Any]:
    r = await api.post(f"/api/v1/orphans/{orphan_id}/wishes", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _create_need(
    api: AsyncClient, admin_headers: dict[str, str], orphan_id: str, **body: Any
) -> dict[str, Any]:
    r = await api.post(f"/api/v1/orphans/{orphan_id}/needs", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def _set_raised_directly(table: str, row_id: str, amount: str) -> None:
    """Plant a partial ``raised_amount`` the way ONLY R8's webhook ever will —
    directly on the row (no R7 endpoint can move it)."""
    async with make_session() as db:
        await db.execute(
            text(f"UPDATE {table} SET raised_amount = :amt WHERE id = :id"),  # noqa: S608
            {"amt": amount, "id": row_id},
        )
        await db.commit()


async def _foreign_org_fixture() -> tuple[str, str, str, str]:
    """Plant a FOREIGN organization with its own partner + orphan + one wish +
    one need, written directly (no API surface crosses orgs). Returns
    (foreign_orphan_id, foreign_wish_id, foreign_need_id, foreign_org_id)."""
    suffix = uuid.uuid4().hex[:6]
    async with make_session() as db:
        other_org = Organization(
            code=f"R7X-{suffix}",
            name_ar=f"منظمة-أخرى-{suffix}",
            name_en=f"Other Org {suffix}",
            org_type="standalone",
            country_code="KW",
        )
        db.add(other_org)
        await db.flush()
        foreign_partner = PartnerOrganization(
            organization_id=other_org.id,
            code=f"PRTX-{suffix}",
            name_ar=f"شريك-أجنبي-{suffix}",
            name_en=f"Foreign Partner {suffix}",
            country_code="KW",
            status="active",
        )
        db.add(foreign_partner)
        await db.flush()
        foreign_orphan = Orphan(
            organization_id=other_org.id,
            partner_organization_id=foreign_partner.id,
            code=f"ORPX-{suffix}",
            first_name="يتيمة-أجنبية",
            family_name="عائلة-أجنبية",
            date_of_birth=datetime(2013, 1, 1, tzinfo=UTC).date(),
            gender="F",
        )
        db.add(foreign_orphan)
        await db.flush()
        foreign_wish = OrphanWish(
            organization_id=other_org.id,
            orphan_id=foreign_orphan.id,
            title="أمنية-أجنبية",
            target_amount=Decimal("30.00"),
            currency="KWD",
        )
        foreign_need = OrphanNeed(
            organization_id=other_org.id,
            orphan_id=foreign_orphan.id,
            title="احتياج-أجنبي",
            category="rent",
            target_amount=Decimal("50.00"),
            currency="KWD",
        )
        db.add(foreign_wish)
        db.add(foreign_need)
        await db.commit()
        return (
            str(foreign_orphan.id),
            str(foreign_wish.id),
            str(foreign_need.id),
            str(other_org.id),
        )


# ── Staff CRUD round-trip ──────────────────────────────────────────────────


async def test_wishes_staff_crud_round_trip(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Create → list → patch → delete, with the staff view carrying the full
    row (internal_note, system-managed raised_amount/status, timestamps) and
    the coded status transitioning ONLY via the controlled PATCH field."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    created = await _create_wish(
        api,
        auth_headers,
        orphan["id"],
        title="دراجة هوائية",
        description="تحلم بدراجة تذهب بها إلى الحلقة.",
        internal_note=_PLANTED_WISH_NOTE,
        target_amount="45.00",
        currency="KWD",
    )
    assert created["orphan_id"] == orphan["id"]
    assert created["title"] == "دراجة هوائية"
    assert created["internal_note"] == _PLANTED_WISH_NOTE
    assert Decimal(str(created["target_amount"])) == Decimal("45.00")
    assert created["currency"] == "KWD"
    # System defaults — never client-settable.
    assert Decimal(str(created["raised_amount"])) == Decimal("0")
    assert created["status"] == "open"
    assert created["created_at"] and created["updated_at"]

    second = await _create_wish(
        api, auth_headers, orphan["id"], title="مصحف مجوّد", target_amount="10.00", currency="KWD"
    )
    assert second["description"] is None and second["internal_note"] is None

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/wishes", headers=auth_headers)
    assert r.status_code == 200, r.text
    items = r.json()
    # Oldest first — the donor block renders the same order.
    assert [w["id"] for w in items] == [created["id"], second["id"]]

    r = await api.patch(
        f"/api/v1/wishes/{second['id']}",
        json={"status": "fulfilled", "internal_note": "سُلّمت في حفل الحلقة."},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    patched = r.json()
    assert patched["title"] == "مصحف مجوّد"  # untouched — PATCH applies only supplied fields
    assert patched["status"] == "fulfilled"
    assert patched["internal_note"] == "سُلّمت في حفل الحلقة."

    r = await api.delete(f"/api/v1/wishes/{second['id']}", headers=auth_headers)
    assert r.status_code == 204, r.text
    r = await api.get(f"/api/v1/orphans/{orphan['id']}/wishes", headers=auth_headers)
    assert [w["id"] for w in r.json()] == [created["id"]]
    # Deleting again 404s — the row is gone.
    r = await api.delete(f"/api/v1/wishes/{second['id']}", headers=auth_headers)
    assert r.status_code == 404


async def test_needs_staff_crud_round_trip(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """Same round-trip for needs, including the coded ``category``."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    created = await _create_need(
        api,
        auth_headers,
        orphan["id"],
        title="بدل إيجار",
        description="مساهمة في إيجار بيت الأسرة.",
        internal_note=_PLANTED_NEED_NOTE,
        category="rent",
        target_amount="90.00",
        currency="KWD",
    )
    assert created["orphan_id"] == orphan["id"]
    assert created["category"] == "rent"
    assert created["internal_note"] == _PLANTED_NEED_NOTE
    assert Decimal(str(created["raised_amount"])) == Decimal("0")
    assert created["status"] == "open"

    second = await _create_need(
        api, auth_headers, orphan["id"], title="قرطاسية", target_amount="8.00", currency="KWD"
    )
    assert second["category"] is None

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/needs", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert [n["id"] for n in r.json()] == [created["id"], second["id"]]

    r = await api.patch(
        f"/api/v1/needs/{second['id']}",
        json={"category": "supplies", "status": "met"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    patched = r.json()
    assert patched["title"] == "قرطاسية"
    assert patched["category"] == "supplies"
    assert patched["status"] == "met"

    r = await api.delete(f"/api/v1/needs/{second['id']}", headers=auth_headers)
    assert r.status_code == 204, r.text
    r = await api.get(f"/api/v1/orphans/{orphan['id']}/needs", headers=auth_headers)
    assert [n["id"] for n in r.json()] == [created["id"]]
    r = await api.delete(f"/api/v1/needs/{second['id']}", headers=auth_headers)
    assert r.status_code == 404


async def test_create_rejects_bad_values(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """status/category are coded vocabularies and the money fields mirror
    payments — an unknown/invalid value (or a blank/oversized title) is a 422,
    never stored."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    base = {"target_amount": "10.00", "currency": "KWD"}
    for path, body in (
        ("wishes", {**base, "title": "   "}),
        ("wishes", {**base, "title": "و" * 121}),
        ("wishes", {**base, "title": "x", "target_amount": "0"}),
        ("wishes", {**base, "title": "x", "target_amount": "-5.00"}),
        ("wishes", {**base, "title": "x", "currency": "KUWAIT"}),
        ("wishes", {**base, "title": "x", "status": "open"}),  # not settable on create
        ("needs", {**base, "title": "x", "category": "not-a-category"}),
        ("needs", {**base, "title": "x", "status": "met"}),  # not settable on create
    ):
        r = await api.post(
            f"/api/v1/orphans/{orphan['id']}/{path}", json=body, headers=auth_headers
        )
        assert r.status_code == 422, f"{path} {body} → {r.status_code}"

    # Unknown status value on the controlled PATCH surface is 422 too.
    wish = await _create_wish(
        api, auth_headers, orphan["id"], title="أمنية", target_amount="10.00", currency="KWD"
    )
    r = await api.patch(
        f"/api/v1/wishes/{wish['id']}", json={"status": "granted"}, headers=auth_headers
    )
    assert r.status_code == 422


# ── raised_amount — system-managed, immutable in R7 ────────────────────────


async def test_raised_amount_immutable_via_api(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """No R7 endpoint can set or move ``raised_amount``: supplying it on create
    or PATCH is a 422 (``extra="forbid"``), and after every accepted mutation
    the stored value is still 0."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    for path in ("wishes", "needs"):
        r = await api.post(
            f"/api/v1/orphans/{orphan['id']}/{path}",
            json={
                "title": "x",
                "target_amount": "10.00",
                "currency": "KWD",
                "raised_amount": "9.00",
            },
            headers=auth_headers,
        )
        assert r.status_code == 422, f"{path}: raised_amount accepted on create"

    wish = await _create_wish(
        api, auth_headers, orphan["id"], title="أمنية", target_amount="10.00", currency="KWD"
    )
    need = await _create_need(
        api, auth_headers, orphan["id"], title="احتياج", target_amount="10.00", currency="KWD"
    )
    r = await api.patch(
        f"/api/v1/wishes/{wish['id']}", json={"raised_amount": "9.00"}, headers=auth_headers
    )
    assert r.status_code == 422
    r = await api.patch(
        f"/api/v1/needs/{need['id']}", json={"raised_amount": "9.00"}, headers=auth_headers
    )
    assert r.status_code == 422

    # A legitimate PATCH leaves raised_amount untouched at 0.
    r = await api.patch(
        f"/api/v1/wishes/{wish['id']}", json={"status": "fulfilled"}, headers=auth_headers
    )
    assert r.status_code == 200
    assert Decimal(str(r.json()["raised_amount"])) == Decimal("0")
    async with make_session() as db:
        stored = await db.scalar(
            text("SELECT raised_amount FROM orphan_wishes WHERE id = :id"), {"id": wish["id"]}
        )
    assert Decimal(str(stored)) == Decimal("0")


# ── Cross-org fence — the explicit organization_id filter ──────────────────


async def test_cross_org_create_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A wish/need can never be attached to another org's orphan: the create
    loads the orphan filtered by the CALLER's organization_id first, so a
    foreign orphan id 404s exactly like an unknown id."""
    foreign_orphan_id, _, _, _ = await _foreign_org_fixture()

    for path in ("wishes", "needs"):
        r = await api.post(
            f"/api/v1/orphans/{foreign_orphan_id}/{path}",
            json={"title": "اختراق", "target_amount": "10.00", "currency": "KWD"},
            headers=auth_headers,
        )
        assert r.status_code == 404, r.text
    async with make_session() as db:
        for table in ("orphan_wishes", "orphan_needs"):
            count = await db.scalar(
                text(  # noqa: S608 — fixed identifier, not user input
                    f"SELECT COUNT(*) FROM {table} WHERE orphan_id = :oid AND title = 'اختراق'"
                ),
                {"oid": foreign_orphan_id},
            )
            assert count == 0


async def test_cross_org_patch_and_delete_404(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PATCH/DELETE on another org's wish/need 404s — the explicit org
    predicate hides the row entirely (no read, no mutation, no existence
    leak)."""
    _, foreign_wish_id, foreign_need_id, _ = await _foreign_org_fixture()

    for path, row_id in (("wishes", foreign_wish_id), ("needs", foreign_need_id)):
        r = await api.patch(
            f"/api/v1/{path}/{row_id}", json={"title": "مسروقة"}, headers=auth_headers
        )
        assert r.status_code == 404, r.text
        r = await api.delete(f"/api/v1/{path}/{row_id}", headers=auth_headers)
        assert r.status_code == 404, r.text
    async with make_session() as db:
        wish_title = await db.scalar(
            text("SELECT title FROM orphan_wishes WHERE id = :id"), {"id": foreign_wish_id}
        )
        need_title = await db.scalar(
            text("SELECT title FROM orphan_needs WHERE id = :id"), {"id": foreign_need_id}
        )
    assert wish_title == "أمنية-أجنبية"  # untouched
    assert need_title == "احتياج-أجنبي"  # untouched


async def test_foreign_org_rows_on_our_orphan_never_surface(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Even when a FOREIGN-org wish/need row points at OUR orphan (data
    corruption / hostile write), neither the staff lists nor the donor blocks
    ever show it: all filter organization_id explicitly, because the superuser
    DB connection bypasses RLS."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    _, _, _, foreign_org_id = await _foreign_org_fixture()
    async with make_session() as db:
        db.add(
            OrphanWish(
                organization_id=uuid.UUID(foreign_org_id),
                orphan_id=uuid.UUID(orphan["id"]),
                title="أمنية-مزروعة",
                target_amount=Decimal("10.00"),
                currency="KWD",
            )
        )
        db.add(
            OrphanNeed(
                organization_id=uuid.UUID(foreign_org_id),
                orphan_id=uuid.UUID(orphan["id"]),
                title="احتياج-مزروع",
                target_amount=Decimal("10.00"),
                currency="KWD",
            )
        )
        await db.commit()

    for path in ("wishes", "needs"):
        r = await api.get(f"/api/v1/orphans/{orphan['id']}/{path}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == []

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    # The corrupted rows are the only orphan_id matches — so both blocks stay None.
    assert body["wishes"] is None
    assert body["needs"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    assert "أمنية-مزروعة" not in dumped
    assert "احتياج-مزروع" not in dumped


# ── Donor blocks — gating + minimal slice + progress ───────────────────────


async def _sponsored_child_with_wishes_and_needs(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, str]]:
    """A donor sponsoring a child with one partially-raised open wish (planted
    staff-only note) and one open need. Returns (child, wish, need,
    donor_headers)."""
    partner_id = await _partner_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    child = await _make_orphan(api, admin_headers, partner_id)
    wish = await _create_wish(
        api,
        admin_headers,
        child["id"],
        title="دراجة هوائية",
        description="تحلم بدراجة تذهب بها إلى الحلقة.",
        internal_note=_PLANTED_WISH_NOTE,
        target_amount="45.00",
        currency="KWD",
    )
    need = await _create_need(
        api,
        admin_headers,
        child["id"],
        title="بدل إيجار",
        description="مساهمة في إيجار بيت الأسرة.",
        internal_note=_PLANTED_NEED_NOTE,
        category="rent",
        target_amount="90.00",
        currency="KWD",
    )
    # Mid-way progress, planted the way ONLY R8's webhook ever will.
    await _set_raised_directly("orphan_wishes", wish["id"], "18.00")
    await _set_raised_directly("orphan_needs", need["id"], "30.00")
    await _make_sponsorship(api, admin_headers, donor_id, child["id"])
    return child, wish, need, donor_headers


async def test_donor_blocks_visible_with_data(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible (the default) + non-archived rows ⇒ one card per item, EXACTLY
    the allowlist, with a correct derived progress."""
    child, _wish, _need, donor_headers = await _sponsored_child_with_wishes_and_needs(
        api, auth_headers
    )

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["wishes"] is not None
    assert body["needs"] is not None

    wish_items = body["wishes"]["items"]
    assert len(wish_items) == 1
    assert set(wish_items[0].keys()) == _WISH_CARD_KEYS
    assert wish_items[0]["title"] == "دراجة هوائية"
    assert wish_items[0]["status"] == "open"
    assert Decimal(str(wish_items[0]["target_amount"])) == Decimal("45.00")
    assert Decimal(str(wish_items[0]["raised_amount"])) == Decimal("18.00")
    assert wish_items[0]["progress"] == 40  # 18/45

    need_items = body["needs"]["items"]
    assert len(need_items) == 1
    assert set(need_items[0].keys()) == _NEED_CARD_KEYS
    assert need_items[0]["title"] == "بدل إيجار"
    assert need_items[0]["category"] == "rent"
    assert Decimal(str(need_items[0]["raised_amount"])) == Decimal("30.00")
    assert need_items[0]["progress"] == 33  # 30/90, rounded


async def test_donor_blocks_omitted_when_hidden(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Hiding each element strips the whole block server-side even though the
    rows exist — and no wish/need value escapes anywhere else."""
    child, wish, need, donor_headers = await _sponsored_child_with_wishes_and_needs(
        api, auth_headers
    )

    r = await api.put(
        f"/api/v1/orphans/{child['id']}/profile-visibility",
        json={"visibility": {"wishes": False, "needs": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["wishes"] is None
    assert body["needs"] is None
    dumped = json.dumps(body, ensure_ascii=False)
    assert wish["title"] not in dumped
    assert need["title"] not in dumped


async def test_donor_blocks_omitted_without_items(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Visible but nothing on record ⇒ the blocks are omitted (no empty shell)
    — and each reappears as soon as the first row lands."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["wishes"] is None
    assert body["needs"] is None

    await _create_wish(
        api, auth_headers, orphan["id"], title="أمنية", target_amount="10.00", currency="KWD"
    )
    await _create_need(
        api,
        auth_headers,
        orphan["id"],
        title="احتياج",
        category="medicine",
        target_amount="20.00",
        currency="KWD",
    )
    body = await _sponsored_profile(api, donor_headers, orphan["id"])
    assert body["wishes"] == {
        "items": [
            {
                "title": "أمنية",
                "description": None,
                "target_amount": "10.00",
                "currency": "KWD",
                "raised_amount": "0.00",
                "status": "open",
                "progress": 0,
            }
        ]
    }
    assert body["needs"] == {
        "items": [
            {
                "title": "احتياج",
                "description": None,
                "category": "medicine",
                "target_amount": "20.00",
                "currency": "KWD",
                "raised_amount": "0.00",
                "status": "open",
                "progress": 0,
            }
        ]
    }


async def test_archived_rows_never_reach_donor(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Archived wishes/needs are excluded server-side: mixed in with live rows
    they vanish from the blocks, and when ONLY archived rows exist the whole
    block is omitted. A fulfilled/met row still shows (its coded status lets
    the frontend celebrate it)."""
    child, wish, need, donor_headers = await _sponsored_child_with_wishes_and_needs(
        api, auth_headers
    )
    archived_wish = await _create_wish(
        api, auth_headers, child["id"], title="أمنية-قديمة", target_amount="5.00", currency="KWD"
    )
    archived_need = await _create_need(
        api, auth_headers, child["id"], title="احتياج-قديم", target_amount="5.00", currency="KWD"
    )
    for path, row in (("wishes", archived_wish), ("needs", archived_need)):
        r = await api.patch(
            f"/api/v1/{path}/{row['id']}", json={"status": "archived"}, headers=auth_headers
        )
        assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert [w["title"] for w in body["wishes"]["items"]] == [wish["title"]]
    assert [n["title"] for n in body["needs"]["items"]] == [need["title"]]
    dumped = json.dumps(body, ensure_ascii=False)
    assert "أمنية-قديمة" not in dumped
    assert "احتياج-قديم" not in dumped

    # Archive the remaining live rows → the whole blocks are omitted.
    for path, row in (("wishes", wish), ("needs", need)):
        r = await api.patch(
            f"/api/v1/{path}/{row['id']}", json={"status": "archived"}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["wishes"] is None
    assert body["needs"] is None


async def test_fulfilled_and_met_rows_still_show_with_progress_100(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A fulfilled wish / met need stays on the donor block (progress capped
    at 100) — only ``archived`` hides a row."""
    child, wish, need, donor_headers = await _sponsored_child_with_wishes_and_needs(
        api, auth_headers
    )
    await _set_raised_directly("orphan_wishes", wish["id"], "45.00")
    await _set_raised_directly("orphan_needs", need["id"], "95.00")  # over-funded → capped
    r = await api.patch(
        f"/api/v1/wishes/{wish['id']}", json={"status": "fulfilled"}, headers=auth_headers
    )
    assert r.status_code == 200, r.text
    r = await api.patch(f"/api/v1/needs/{need['id']}", json={"status": "met"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    body = await _sponsored_profile(api, donor_headers, child["id"])
    assert body["wishes"]["items"][0]["status"] == "fulfilled"
    assert body["wishes"]["items"][0]["progress"] == 100
    assert body["needs"]["items"][0]["status"] == "met"
    assert body["needs"]["items"][0]["progress"] == 100


# ── Content safety — internal_note (and ids/timestamps) never leak ─────────


async def test_internal_note_ids_timestamps_never_in_donor_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """With both elements visible and fully populated rows, the staff-only
    internal_note, the row ids and the timestamps appear NOWHERE in the donor
    payload — the cards are the allowlist and nothing more."""
    child, wish, need, donor_headers = await _sponsored_child_with_wishes_and_needs(
        api, auth_headers
    )

    body = await _sponsored_profile(api, donor_headers, child["id"])
    dumped = json.dumps(body, ensure_ascii=False)
    assert _PLANTED_WISH_NOTE not in dumped, "staff-only wish note leaked into the donor payload"
    assert _PLANTED_NEED_NOTE not in dumped, "staff-only need note leaked into the donor payload"
    blocks_dump = json.dumps([body["wishes"], body["needs"]], ensure_ascii=False)
    assert '"internal_note"' not in blocks_dump
    assert '"orphan_id"' not in blocks_dump
    for row in (wish, need):
        assert row["id"] not in dumped
        assert row["created_at"] not in dumped


# ── Staff visibility registry ──────────────────────────────────────────────


async def test_wishes_needs_in_staff_registry(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The two new elements appear in the staff GET registry (visible by
    default) and are accepted by the PUT."""
    partner_id = await _partner_id(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)

    r = await api.get(f"/api/v1/orphans/{orphan['id']}/profile-visibility", headers=auth_headers)
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["wishes"] is True
    assert by_key["needs"] is True

    r = await api.put(
        f"/api/v1/orphans/{orphan['id']}/profile-visibility",
        json={"visibility": {"wishes": False, "needs": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    by_key = {e["key"]: e["visible"] for e in r.json()["elements"]}
    assert by_key["wishes"] is False
    assert by_key["needs"] is False


# ── Public (pre-sponsorship) card stays wishes/needs-free ──────────────────


async def test_public_card_exposes_no_wishes_or_needs(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """PublicOrphanCard/Detail are untouched: no wishes/needs key (or value)
    reaches the public browse/detail surfaces even for a child that has both."""
    child, wish, need, _donor_headers = await _sponsored_child_with_wishes_and_needs(
        api, auth_headers
    )
    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE id=:id"),
            {"id": child["id"]},
        )
        await db.commit()

    r = await api.get(f"/api/v1/public/orphans/{child['code']}")
    assert r.status_code == 200, r.text
    dumped = json.dumps(r.json(), ensure_ascii=False)
    assert '"wishes"' not in dumped, "'wishes' leaked onto the public card"
    assert '"needs"' not in dumped, "'needs' leaked onto the public card"
    assert wish["title"] not in dumped
    assert need["title"] not in dumped

    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["code"] == child["code"])
    item_dump = json.dumps(item, ensure_ascii=False)
    assert '"wishes"' not in item_dump
    assert '"needs"' not in item_dump


# ── payments columns — additive, nullable, zero behavioral change ──────────


async def test_payment_creation_unchanged_and_target_columns_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The pre-R7 manual payment flow works exactly as before, and the new
    ``target_type``/``target_id`` columns stay NULL on every row it writes."""
    partner_id = await _partner_id(api, auth_headers)
    donor_id, _donor_headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sponsorship_id = await _make_sponsorship(api, auth_headers, donor_id, orphan["id"])

    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "sponsorship_id": sponsorship_id,
            "amount": "10.00",
            "currency": "KWD",
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    payment_id = r.json()["id"]

    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT target_type, target_id FROM payments WHERE id = :id"),
                {"id": payment_id},
            )
        ).first()
    assert row is not None
    assert row.target_type is None
    assert row.target_id is None


# ── Migration 0031 — fully reversible ──────────────────────────────────────


def _alembic_config() -> Config:
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "migrations"))
    return cfg


async def _table_exists(table: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT 1 FROM information_schema.tables WHERE table_name = :t"),
                {"t": table},
            )
        ).first()
    return row is not None


async def _payments_column_exists(column: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'payments' AND column_name = :c"
                ),
                {"c": column},
            )
        ).first()
    return row is not None


async def test_migration_0031_reversible(
    api: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """upgrade → downgrade → upgrade leaves a clean schema: both tables (and
    their composite org/orphan indexes) plus the two payments columns
    disappear on downgrade and return on upgrade."""
    test_db_url = os.getenv("RUFAQAA_TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip("RUFAQAA_TEST_DATABASE_URL not set")

    monkeypatch.setattr(settings, "DATABASE_URL", test_db_url)
    cfg = _alembic_config()

    assert await _table_exists("orphan_wishes")
    assert await _table_exists("orphan_needs")
    assert await _payments_column_exists("target_type")
    assert await _payments_column_exists("target_id")
    try:
        command.downgrade(cfg, "0030")
        assert not await _table_exists("orphan_wishes")
        assert not await _table_exists("orphan_needs")
        assert not await _payments_column_exists("target_type")
        assert not await _payments_column_exists("target_id")

        command.upgrade(cfg, "0031")
        assert await _table_exists("orphan_wishes")
        assert await _table_exists("orphan_needs")
        assert await _payments_column_exists("target_type")
        assert await _payments_column_exists("target_id")
        async with make_session() as db:
            for table, index in (
                ("orphan_wishes", "idx_orphan_wishes_org_orphan"),
                ("orphan_needs", "idx_orphan_needs_org_orphan"),
            ):
                row = (
                    await db.execute(
                        text("SELECT 1 FROM pg_indexes WHERE tablename = :t AND indexname = :i"),
                        {"t": table, "i": index},
                    )
                ).first()
                assert row is not None, f"missing index {index}"
    finally:
        # Always leave the DB at head, whatever happened above.
        command.upgrade(cfg, "head")
