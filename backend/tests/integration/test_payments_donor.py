"""Donor-facing payment endpoint scoping + content tests (GET /me/payments).

Two things are exercised:

* Scoping: a donor sees only their own payments; another donor's payments
  never appear; orphan_id filter restricts correctly; an orphan the donor
  does NOT sponsor → empty page.
* Content safety: the response payload never carries internal fields
  (gateway_transaction_id, bank_reference, payment_gateway, metadata,
  notes, donor_id, organization_id, created_by, initiated_by_user_id,
  failure_reason).
* Access control: staff/admin without donor_id → 400; donor passing a
  different donor_id → 403.
* Pagination: total / limit / offset reported correctly.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session

# Fields that must NEVER appear in a donor-facing payment response.
_FORBIDDEN_FIELDS = {
    "gateway_transaction_id",
    "bank_reference",
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


async def _seed_org_and_partner(api: AsyncClient, headers: dict[str, str]) -> tuple[str, str]:
    """Return (org_id, partner_id) from the seed DB."""
    me = (await api.get("/api/v1/auth/me", headers=headers)).json()
    org_id = me["organization_id"]
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    partner_id = row["items"][0]["id"]
    return org_id, partner_id


async def _signup_donor(api: AsyncClient) -> tuple[str, dict[str, str]]:
    """Sign up + verify a new donor. Returns (donor_id, auth_headers)."""
    email = f"d-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "full_name": "Test Donor"},
    )
    token = r.json()["debug_verify_token"]
    await api.post("/api/v1/auth/verify-email", json={"token": token})
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    access = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {access}"}
    me = (await api.get("/api/v1/donor/me", headers=headers)).json()
    return me["id"], headers


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str], partner_id: str) -> str:
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
    return str(r.json()["id"])


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
    sponsorship_id: str,
    orphan_id: str,
    status: str = "completed",
) -> str:
    """Insert a payment row directly via SQL and return its id."""
    pay_id = str(uuid.uuid4())
    code = f"PAY-TEST-{uuid.uuid4().hex[:6].upper()}"
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
                " 10.00, 'KWD', 'knet', :status, now(), "
                " CASE WHEN :status='completed' THEN now() ELSE NULL END, "
                " CASE WHEN :status='failed' THEN now() ELSE NULL END, "
                " CASE WHEN :status='failed' THEN 'card declined' ELSE NULL END, "
                " 'gw-txn-SECRET', 'bank-ref-SECRET', 'myfatoorah', "
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
            },
        )
        await db.commit()
    return pay_id


# ── Scoping tests ─────────────────────────────────────────────────────────────


async def test_donor_sees_only_own_payments(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A's payments never appear in B's list."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_a_id, headers_a = await _signup_donor(api)
    donor_b_id, headers_b = await _signup_donor(api)

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
    donor_id, headers = await _signup_donor(api)

    orphan_1 = await _make_orphan(api, auth_headers, partner_id)
    orphan_2 = await _make_orphan(api, auth_headers, partner_id)
    sp_1 = await _activate_sponsorship(api, auth_headers, donor_id, orphan_1)
    sp_2 = await _activate_sponsorship(api, auth_headers, donor_id, orphan_2)

    pay_1 = await _insert_payment(org_id, donor_id, sp_1, orphan_1)
    pay_2 = await _insert_payment(org_id, donor_id, sp_2, orphan_2)

    page = (
        await api.get(f"/api/v1/me/payments?orphan_id={orphan_1}", headers=headers)
    ).json()
    ids = {it["id"] for it in page["items"]}
    assert pay_1 in ids
    assert pay_2 not in ids


async def test_unsponsored_orphan_id_returns_empty(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An orphan_id the donor does NOT sponsor yields an empty page — no leak."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api)
    other_donor_id, _ = await _signup_donor(api)

    orphan_mine = await _make_orphan(api, auth_headers, partner_id)
    orphan_other = await _make_orphan(api, auth_headers, partner_id)
    sp_mine = await _activate_sponsorship(api, auth_headers, donor_id, orphan_mine)
    sp_other = await _activate_sponsorship(api, auth_headers, other_donor_id, orphan_other)

    await _insert_payment(org_id, donor_id, sp_mine, orphan_mine)
    await _insert_payment(org_id, other_donor_id, sp_other, orphan_other)

    page = (
        await api.get(f"/api/v1/me/payments?orphan_id={orphan_other}", headers=headers)
    ).json()
    assert page["total"] == 0
    assert page["items"] == []


# ── Content safety ────────────────────────────────────────────────────────────


async def test_forbidden_fields_never_in_payload(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """None of the internal/sensitive fields reach the donor."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api)
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
    donor_id, headers = await _signup_donor(api)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan)
    await _insert_payment(org_id, donor_id, sp, orphan, status="completed")

    page = (await api.get("/api/v1/me/payments", headers=headers)).json()
    item = next(it for it in page["items"] if it.get("orphan_id") == orphan)

    expected_fields = {
        "id", "code", "amount", "currency", "payment_method", "status",
        "initiated_at", "completed_at", "receipt_number", "receipt_issued_at",
        "receipt_url", "sponsorship_id", "orphan_id", "amount_in_default_currency",
    }
    for field in expected_fields:
        assert field in item, f"Expected field '{field}' missing from donor payload"


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
    _, headers_a = await _signup_donor(api)
    donor_b_id, _ = await _signup_donor(api)

    r = await api.get(f"/api/v1/me/payments?donor_id={donor_b_id}", headers=headers_a)
    assert r.status_code == 403


async def test_admin_with_valid_donor_id_gets_200(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Staff/admin passing a valid donor_id preview correctly."""
    donor_id, _ = await _signup_donor(api)
    r = await api.get(f"/api/v1/me/payments?donor_id={donor_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["total"] >= 0


# ── Pagination ────────────────────────────────────────────────────────────────


async def test_pagination_limit_offset(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """total / limit / offset are reported correctly."""
    org_id, partner_id = await _seed_org_and_partner(api, auth_headers)
    donor_id, headers = await _signup_donor(api)
    orphan = await _make_orphan(api, auth_headers, partner_id)
    sp = await _activate_sponsorship(api, auth_headers, donor_id, orphan)

    for _ in range(3):
        await _insert_payment(org_id, donor_id, sp, orphan)

    full = (await api.get("/api/v1/me/payments?limit=100&offset=0", headers=headers)).json()
    total = full["total"]
    assert total >= 3

    page1 = (
        await api.get("/api/v1/me/payments?limit=2&offset=0", headers=headers)
    ).json()
    page2 = (
        await api.get("/api/v1/me/payments?limit=2&offset=2", headers=headers)
    ).json()

    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert len(page1["items"]) == 2

    assert page2["limit"] == 2
    assert page2["offset"] == 2

    ids1 = {it["id"] for it in page1["items"]}
    ids2 = {it["id"] for it in page2["items"]}
    assert ids1.isdisjoint(ids2), "Pages must not overlap"
    assert len(ids1 | ids2) == len(ids1) + len(ids2)
