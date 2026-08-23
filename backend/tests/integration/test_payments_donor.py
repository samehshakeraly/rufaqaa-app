"""Donor-facing payment endpoint scoping + content tests (GET /me/payments).

Two things are exercised:

* Scoping: a donor sees only their own payments; another donor's payments
  never appear; orphan_id filter restricts correctly; an orphan the donor
  does NOT sponsor → empty page.
* Content safety: the response payload never carries internal fields
  (payment_gateway, metadata, notes, donor_id, organization_id,
  created_by, initiated_by_user_id, failure_reason). The donor's OWN
  references (gateway_transaction_id, bank_reference) and the child's
  name + code ARE part of the payload since PR-D09.
* Enrichment: orphan_name/orphan_code populated from the payment's
  orphan_id; null when the payment has no orphan.
* Access control: staff/admin without donor_id → 400; donor passing a
  different donor_id → 403.
* Pagination: total / limit / offset reported correctly.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# Fields that must NEVER appear in a donor-facing payment response.
_FORBIDDEN_FIELDS = {
    "payment_gateway",
    "metadata",
    "payment_metadata",
    "notes",
    "donor_id",
    "organization_id",
    "created_by",
    "initiated_by_user_id",
    "failure_reason",
}

# The COMPLETE donor-facing payload — anything beyond this set is a leak.
_EXPECTED_FIELDS = {
    "id",
    "code",
    "amount",
    "currency",
    "amount_in_default_currency",
    "payment_method",
    "status",
    "initiated_at",
    "completed_at",
    "receipt_number",
    "receipt_issued_at",
    "receipt_url",
    "sponsorship_id",
    "orphan_id",
    # PR-W01: which general pool the donation went into ("waqf"), or null.
    # Donor-safe by construction — it is the donor's own choice, and it
    # names a pool, never a child.
    "target_type",
    "gateway_transaction_id",
    "bank_reference",
    "orphan_name",
    "orphan_code",
}


async def _seed_org_and_partner(api: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    """Return (org_id, partner_id) from the seed DB."""
    me = (await api.get("/api/v1/auth/me", headers=headers)).json()
    org_id = me["organization_id"]
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    partner_id = row["items"][0]["id"]
    return org_id, partner_id


async def _signup_donor(
    api: AsyncClient,
    admin_headers: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """Create an org-scoped donor via admin API, invite + accept a linked user.

    Returns (donor_id, auth_headers).

    Self-service signup puts donors in the platform org, which is different
    from the admin's org. Using the admin create endpoint ensures the donor
    is org-scoped so POST /api/v1/sponsorships can find it.
    """
    suffix = uuid.uuid4().hex[:8]
    email = f"d-{suffix}@example.com"
    password = "longenoughpw1"

    # Create org-scoped donor record via admin API.
    r = await api.post(
        "/api/v1/donors",
        json={"full_name": f"Test Donor {suffix}", "email": email},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    donor_id = str(r.json()["id"])

    # Invite a user with donor role so they can authenticate.
    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "Test", "last_name": "Donor", "role": "donor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = str(r.json()["user"]["id"])

    # Accept invite.
    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    # Login to get access token.
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {access}"}

    # Link the user to the donor record so _resolve_donor_id can locate it.
    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()

    return donor_id, headers


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str], partner_id: str) -> str:
    orphan_id, _, _ = await _make_orphan_full(api, admin_headers, partner_id)
    return orphan_id


async def _make_orphan_full(
    api: AsyncClient, admin_headers: dict[str, str], partner_id: str
) -> tuple[str, str, str]:
    """Create an orphan; return (id, full_name, code)."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"pay-{suffix}",
            "family_name": "Test",
            "date_of_birth": "2015-03-01",
            "gender": "M",
            "nationality": "KW",
            "father_name": f"father-{suffix}",
            "partner_organization_id": partner_id,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return str(body["id"]), f"pay-{suffix} Test", str(body["code"])


async def _activate_sponsorship(
    api: AsyncClient,
    admin_headers: dict[str, str],
    donor_id: str,
    orphan_id: str,
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
    sp_id = str(r.json()["id"])
    await api.post(f"/api/v1/sponsorships/{sp_id}/activate", headers=admin_headers)
    return sp_id


async def _insert_payment(
    org_id: str,
    donor_id: str,
    sponsorship_id: str | None,
    orphan_id: str | None,
    status: str = "completed",
    gateway_transaction_id: str | None = "gw-txn-1",
    bank_reference: str | None = "bank-ref-1",
) -> str:
    """Insert a payment row directly via SQL and return its id."""
    pay_id = str(uuid.uuid4())
    code = f"PAY-TEST-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(UTC)
    completed_at = now if status == "completed" else None
    failed_at = now if status == "failed" else None
    failure_reason = "card declined" if status == "failed" else None
    async with make_session() as db:
        await db.execute(
            text(
                "INSERT INTO payments "
                "(id, organization_id, code, donor_id, sponsorship_id, orphan_id, "
                " amount, currency, payment_method, status, initiated_at, "
                " completed_at, failed_at, failure_reason, "
                " gateway_transaction_id, bank_reference, payment_gateway, "
                " notes, created_by) "
                "VALUES (:id, :org, :code, :donor, :sp, :orphan, "
                " 10.00, 'KWD', 'knet', :status, :initiated_at, "
                " :completed_at, :failed_at, :failure_reason, "
                " :gw_txn, :bank_ref, 'myfatoorah', "
                " 'internal note SECRET', NULL)"
            ),
            {
                "id": pay_id,
                "org": org_id,
                "code": code,
                "donor": donor_id,
                "sp": sponsorship_id,
                "orphan": orphan_id,
                "status": status,
                "initiated_at": now,
                "completed_at": completed_at,
                "failed_at": failed_at,
                "failure_reason": failure_reason,
                "gw_txn": gateway_transaction_id,
                "bank_ref": bank_reference,
            },
        )
        await db.commit()
    return pay_id


# ── Scoping tests ─────────────────────────────────────────────────────────────


async def test_donor_sees_only_own_payments(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """A's payments never appear in B's list."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_a_id, headers_a = await _signup_donor(api, auth_headers)
    donor_b_id, headers_b = await _signup_donor(api, auth_headers)

    orphan_a = await _make_orphan(api, auth_headers, partner_id)
    orphan_b = await _make_orphan(api, auth_headers, partner_id)
    sp_a = await _activate_sponsorship(api, auth_headers, donor_a_id, orphan_a)
    sp_b = await _activate_sponsorship(api, auth_headers, donor_b_id, orphan_b)

    pay_a = await _insert_payment(org_id, donor_a_id, sp_a, orphan_a)
    pay_b = await _insert_payment(org_id, donor_b_id, sp_b, orphan_b)

    page_a = (await api.get("/api/v1/me/payments", headers=headers_a)).json()
    page_b = (await api.get("/api/v1/me/payments", headers=headers_b)).json()

    ids_a = {it["id"] for it in page_a["items"]}
    ids_b = {it["id"] for it in page_b["items"]}

    assert pay_a in ids_a
    assert pay_b not in ids_a

    assert pay_b in ids_b
    assert pay_a not in ids_b


async def test_orphan_id_filter_restricts_to_that_child(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """With orphan_id= set, only payments for that child appear."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)

    orphan_1 = await _make_orphan(api, auth_headers, partner_id)
    orphan_2 = await _make_orphan(api, auth_headers, partner_id)
    sp_1 = await _activate_sponsorship(api, auth_headers, donor_id, orphan_1)
    sp_2 = await _activate_sponsorship(api, auth_headers, donor_id, orphan_2)

    pay_1 = await _insert_payment(org_id, donor_id, sp_1, orphan_1)
    pay_2 = await _insert_payment(org_id, donor_id, sp_2, orphan_2)

    page = (await api.get(f"/api/v1/me/payments?orphan_id={orphan_1}", headers=headers)).json()
    ids = {it["id"] for it in page["items"]}
    assert pay_1 in ids
    assert pay_2 not in ids


async def test_unsponsored_orphan_id_returns_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An orphan_id the donor does NOT sponsor yields an empty page — no leak."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    other_donor_id, _ = await _signup_donor(api, auth_headers)

    orphan_mine = await _make_orphan(api, auth_headers, partner_id)
    orphan_other = await _make_orphan(api, auth_headers, partner_id)
    sp_mine = await _activate_sponsorship(api, auth_headers, donor_id, orphan_mine)
    sp_other = await _activate_sponsorship(api, auth_headers, other_donor_id, orphan_other)

    await _insert_payment(org_id, donor_id, sp_mine, orphan_mine)
    await _insert_payment(org_id, other_donor_id, sp_other, orphan_other)

    page = (await api.get(f"/api/v1/me/payments?orphan_id={orphan_other}", headers=headers)).json()
    assert page["total"] == 0
    assert page["items"] == []


# ── Content safety ────────────────────────────────────────────────────────────


async def test_forbidden_fields_never_in_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """None of the internal/sensitive fields reach the donor."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    await _insert_payment(org_id, donor_id, sp, orphan, status="completed")

    page = (await api.get("/api/v1/me/payments", headers=headers)).json()
    assert page["total"] >= 1
    for item in page["items"]:
        for field in _FORBIDDEN_FIELDS:
            assert field not in item, f"Forbidden field '{field}' leaked into donor payload"


async def test_safe_fields_present_in_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Expected donor-safe fields are all present."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    await _insert_payment(org_id, donor_id, sp, orphan, status="completed")

    page = (await api.get("/api/v1/me/payments", headers=headers)).json()
    item = next(it for it in page["items"] if it.get("orphan_id") == orphan)

    # Exact-set equality: a field beyond the declared donor-safe payload
    # (e.g. payment_gateway) failing this test is the point.
    assert set(item.keys()) == _EXPECTED_FIELDS


# ── Enrichment (PR-D09): orphan name/code + payment references ────────────────


async def test_orphan_name_and_code_populated(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A payment carrying an orphan_id surfaces the child's name + code."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan_id, orphan_name, orphan_code = await _make_orphan_full(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan_id)
    pay = await _insert_payment(org_id, donor_id, sp, orphan_id)

    page = (await api.get("/api/v1/me/payments", headers=headers)).json()
    item = next(it for it in page["items"] if it["id"] == pay)
    assert item["orphan_name"] == orphan_name
    assert item["orphan_code"] == orphan_code


async def test_payment_without_orphan_has_null_name_and_code(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A general donation (no orphan_id) → both null, no exception."""
    org_id, _ = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    pay = await _insert_payment(org_id, donor_id, None, None)

    r = await api.get("/api/v1/me/payments", headers=headers)
    assert r.status_code == 200
    item = next(it for it in r.json()["items"] if it["id"] == pay)
    assert item["orphan_id"] is None
    assert item["orphan_name"] is None
    assert item["orphan_code"] is None


async def test_references_present_when_set_null_otherwise(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """gateway_transaction_id / bank_reference pass through when stored,
    stay null when the row has none."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    pay_with = await _insert_payment(
        org_id,
        donor_id,
        sp,
        orphan,
        status="failed",
        gateway_transaction_id="gw-txn-42",
        bank_reference="bank-ref-42",
    )
    pay_without = await _insert_payment(
        org_id,
        donor_id,
        sp,
        orphan,
        gateway_transaction_id=None,
        bank_reference=None,
    )

    page = (await api.get("/api/v1/me/payments", headers=headers)).json()
    by_id = {it["id"]: it for it in page["items"]}
    assert by_id[pay_with]["gateway_transaction_id"] == "gw-txn-42"
    assert by_id[pay_with]["bank_reference"] == "bank-ref-42"
    assert by_id[pay_without]["gateway_transaction_id"] is None
    assert by_id[pay_without]["bank_reference"] is None


async def test_enrichment_never_leaks_across_donors(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Donor A's payload never carries donor B's orphan name/code or
    payment references — anywhere in the response body."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_a_id, headers_a = await _signup_donor(api, auth_headers)
    donor_b_id, _ = await _signup_donor(api, auth_headers)

    orphan_a = await _make_orphan(api, auth_headers, partner_id)
    orphan_b_id, orphan_b_name, orphan_b_code = await _make_orphan_full(
        api, auth_headers, partner_id
    )
    sp_a = await _activate_sponsorship(api, auth_headers, donor_a_id, orphan_a)
    sp_b = await _activate_sponsorship(api, auth_headers, donor_b_id, orphan_b_id)

    await _insert_payment(org_id, donor_a_id, sp_a, orphan_a)
    await _insert_payment(
        org_id,
        donor_b_id,
        sp_b,
        orphan_b_id,
        status="failed",
        gateway_transaction_id="gw-txn-OTHER-DONOR",
        bank_reference="bank-ref-OTHER-DONOR",
    )

    r = await api.get("/api/v1/me/payments", headers=headers_a)
    assert r.status_code == 200
    body = r.text
    assert orphan_b_name not in body
    assert orphan_b_code not in body
    assert "gw-txn-OTHER-DONOR" not in body
    assert "bank-ref-OTHER-DONOR" not in body


# ── Access control ────────────────────────────────────────────────────────────


async def test_staff_without_donor_id_gets_400(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Non-donor callers must supply donor_id; omitting it → 400."""
    r = await api.get("/api/v1/me/payments", headers=auth_headers)
    assert r.status_code == 400


async def test_donor_passing_other_donor_id_gets_403(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A donor may not pass a different donor_id to peek at another donor."""
    _, headers_a = await _signup_donor(api, auth_headers)
    donor_b_id, _ = await _signup_donor(api, auth_headers)

    r = await api.get(f"/api/v1/me/payments?donor_id={donor_b_id}", headers=headers_a)
    assert r.status_code == 403


async def test_admin_with_valid_donor_id_gets_200(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Staff/admin passing a valid donor_id preview correctly."""
    donor_id, _ = await _signup_donor(api, auth_headers)
    r = await api.get(f"/api/v1/me/payments?donor_id={donor_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["total"] >= 0


# ── Pagination ────────────────────────────────────────────────────────────────


async def test_pagination_limit_offset(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """total / limit / offset are reported correctly."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    for _ in range(3):
        await _insert_payment(org_id, donor_id, sp, orphan)

    full = (await api.get("/api/v1/me/payments?limit=100&offset=0", headers=headers)).json()
    total = full["total"]
    assert total >= 3

    page1 = (await api.get("/api/v1/me/payments?limit=2&offset=0", headers=headers)).json()
    page2 = (await api.get("/api/v1/me/payments?limit=2&offset=2", headers=headers)).json()

    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert len(page1["items"]) == 2

    assert page2["limit"] == 2
    assert page2["offset"] == 2

    ids1 = {it["id"] for it in page1["items"]}
    ids2 = {it["id"] for it in page2["items"]}
    assert ids1.isdisjoint(ids2), "Pages must not overlap"
    assert len(ids1 | ids2) == len(ids1) + len(ids2)
