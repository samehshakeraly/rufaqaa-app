"""Server-side filters + list-payload enrichment on GET /payments.

Mirrors the PR #79 server-filter pattern: each added filter (date range,
method, currency, payment_type) is exercised end-to-end, and the enriched
payload (``payment_type``, ``orphan_code``, ``donor_reference``) is asserted —
including the privacy rule that no donor/orphan *name* and no donor *email* is
ever present on a list row.

Every test scopes its queries to a freshly-created donor (via the existing
``donor_id`` list param), so the asserted result sets are exact regardless of
the other payments the session has accumulated.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_donor(api: AsyncClient, h: dict[str, str]) -> dict[str, Any]:
    email = f"payf-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post(
        "/api/v1/donors", json={"full_name": "كافل اختبار", "email": email}, headers=h
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> dict[str, Any]:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يتيم-{suffix}",
            "family_name": "دفع",
            "date_of_birth": "2017-08-10",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _make_sponsorship(
    api: AsyncClient, h: dict[str, str], donor_id: str, orphan_id: str
) -> dict[str, Any]:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "currency": "KWD",
            "start_date": "2026-06-01",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _make_payment(
    api: AsyncClient, h: dict[str, str], donor_id: str, **fields: object
) -> dict[str, Any]:
    payload: dict[str, object] = {
        "donor_id": donor_id,
        "amount": "20.00",
        "currency": "KWD",
        "payment_method": "cash",
        **fields,
    }
    r = await api.post("/api/v1/payments", json=payload, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _set_completed_at(payment_id: str, when: datetime) -> None:
    async with make_session() as db:
        await db.execute(
            text("UPDATE payments SET completed_at = :w WHERE id = CAST(:id AS uuid)"),
            {"w": when, "id": payment_id},
        )
        await db.commit()


async def _list(api: AsyncClient, h: dict[str, str], **params: object) -> dict[str, Any]:
    params.setdefault("limit", 100)
    r = await api.get("/api/v1/payments", params=params, headers=h)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def test_payment_type_is_derived_and_filtered(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor = await _make_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor["id"], orphan["id"])

    kafala = await _make_payment(api, auth_headers, donor["id"], sponsorship_id=sp["id"])
    general = await _make_payment(api, auth_headers, donor["id"])

    # Derived on every row: kafala when tied to a sponsorship, else general.
    by_id = {p["id"]: p for p in (await _list(api, auth_headers, donor_id=donor["id"]))["items"]}
    assert by_id[kafala["id"]]["payment_type"] == "kafala"
    assert by_id[general["id"]]["payment_type"] == "general"

    only_kafala = await _list(api, auth_headers, donor_id=donor["id"], payment_type="kafala")
    assert [p["id"] for p in only_kafala["items"]] == [kafala["id"]]
    assert only_kafala["total"] == 1

    only_general = await _list(api, auth_headers, donor_id=donor["id"], payment_type="general")
    assert [p["id"] for p in only_general["items"]] == [general["id"]]
    assert only_general["total"] == 1


async def test_list_enriches_codes_and_never_exposes_identity(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor = await _make_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor["id"], orphan["id"])

    kafala = await _make_payment(api, auth_headers, donor["id"], sponsorship_id=sp["id"])
    general = await _make_payment(api, auth_headers, donor["id"])

    rows = {p["id"]: p for p in (await _list(api, auth_headers, donor_id=donor["id"]))["items"]}

    # donor_reference is the donor's (non-identifying) code on every row.
    assert rows[kafala["id"]]["donor_reference"] == donor["code"]
    assert rows[general["id"]]["donor_reference"] == donor["code"]

    # orphan_code is the orphan's code when present (kafala derives it from the
    # sponsorship), and null for a general payment with no orphan.
    assert rows[kafala["id"]]["orphan_code"] == orphan["code"]
    assert rows[general["id"]]["orphan_code"] is None

    # Privacy / child-safety: no donor/orphan name and no donor email ever ship
    # on a list row — only codes.
    for row in rows.values():
        assert "donor_name" not in row
        assert "donor_email" not in row
        assert "orphan_name" not in row
        assert orphan["first_name"] not in str(row)


async def test_method_and_currency_filters(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor = await _make_donor(api, auth_headers)
    cash_kwd = await _make_payment(
        api, auth_headers, donor["id"], payment_method="cash", currency="KWD"
    )
    knet_usd = await _make_payment(
        api, auth_headers, donor["id"], payment_method="knet", currency="USD"
    )

    by_method = await _list(api, auth_headers, donor_id=donor["id"], method="cash")
    assert [p["id"] for p in by_method["items"]] == [cash_kwd["id"]]

    by_currency = await _list(api, auth_headers, donor_id=donor["id"], currency="USD")
    assert [p["id"] for p in by_currency["items"]] == [knet_usd["id"]]


async def test_date_range_filter(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    donor = await _make_donor(api, auth_headers)
    older = await _make_payment(api, auth_headers, donor["id"])
    newer = await _make_payment(api, auth_headers, donor["id"])
    await _set_completed_at(older["id"], datetime(2020, 1, 1, tzinfo=UTC))
    await _set_completed_at(newer["id"], datetime(2026, 1, 1, tzinfo=UTC))

    cutoff = "2023-01-01T00:00:00+00:00"
    from_only = await _list(api, auth_headers, donor_id=donor["id"], date_from=cutoff)
    assert [p["id"] for p in from_only["items"]] == [newer["id"]]

    to_only = await _list(api, auth_headers, donor_id=donor["id"], date_to=cutoff)
    assert [p["id"] for p in to_only["items"]] == [older["id"]]


async def test_filter_param_validation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    # currency must be a 3-letter code.
    r = await api.get("/api/v1/payments", params={"currency": "US"}, headers=auth_headers)
    assert r.status_code == 422, r.text
    # method must be a known PaymentMethod.
    r = await api.get("/api/v1/payments", params={"method": "bitcoin"}, headers=auth_headers)
    assert r.status_code == 422, r.text
    # payment_type only accepts the two derived values (never "zakat").
    r = await api.get("/api/v1/payments", params={"payment_type": "zakat"}, headers=auth_headers)
    assert r.status_code == 422, r.text
