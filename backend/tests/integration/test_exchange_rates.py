"""R8-A2 — admin-maintained FX table + org-currency denomination.

Covers the /exchange-rates admin endpoints, the FX fields written by the
payment endpoints (manual tolerates a missing rate; the gateway paths fail
closed), and the sponsorship currency pin. The MyFatoorah service is
monkey-patched where a checkout is opened, so nothing leaves the box.

Currency codes must come from the seeded ``currencies`` table (payments/
sponsorships carry a legacy FK to it), so each scenario RESERVES one seeded
code to stay independent and rerunnable against a persistent DB:

* USD — manual payment conversion
* EUR — most-recent-rate-wins (winning rate inserted at NOW, so leftovers
  from earlier runs can never outrank it)
* SAR — gateway initiate with a rate
* EGP — the no-rate-configured currency; NO test ever records an EGP rate
* GBP / AED — admin endpoint validation
"""

from __future__ import annotations

import random
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.services import myfatoorah

SEED_DEFAULT_CURRENCY = "KWD"  # the seed org never sets one -> model default


@pytest.fixture
def fake_gateway(monkeypatch):
    """Stub MyFatoorah's SendPayment so initiate flows run end-to-end
    against the real DB without any outbound HTTP."""
    state: dict = {"prefix": uuid.uuid4().hex[:8], "counter": 0}

    async def _fake_send_payment(**kw):
        state["counter"] += 1
        invoice_id = f"{state['prefix']}-{state['counter']}"
        return myfatoorah.SendPaymentResult(
            invoice_id=invoice_id,
            payment_url=f"https://apitest.myfatoorah.com/checkout/{invoice_id}",
            raw={"InvoiceId": invoice_id},
        )

    monkeypatch.setattr(myfatoorah, "send_payment", _fake_send_payment)
    return state


async def _make_donor(api: AsyncClient, h: dict[str, str]) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/donors",
        json={"full_name": f"كافل {suffix}", "email": f"fx-{suffix}@example.com"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يتيم-{unique}",
            "family_name": "صرف",
            "date_of_birth": "2016-03-01",
            "gender": "F",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{unique}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _put_rate(
    api: AsyncClient,
    h: dict[str, str],
    base: str,
    rate: str,
    quote: str = SEED_DEFAULT_CURRENCY,
    effective_at: str | None = None,
) -> dict:
    body: dict = {"base_currency": base, "quote_currency": quote, "rate": rate}
    if effective_at is not None:
        body["effective_at"] = effective_at
    r = await api.post("/api/v1/exchange-rates", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _random_past_at() -> str:
    """A microsecond-unique HISTORICAL effective_at, so reruns against the
    same DB never collide on the (org, pair, effective_at) uniqueness."""
    base = datetime(2020, 1, 1, tzinfo=UTC)
    offset = timedelta(
        seconds=random.randrange(300 * 24 * 3600), microseconds=random.randrange(10**6)
    )
    return (base + offset).isoformat()


# ── /exchange-rates admin endpoints ─────────────────────────────────


async def test_create_and_list_rates(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    created = await _put_rate(api, auth_headers, "GBP", "0.37500000")
    assert created["base_currency"] == "GBP"
    assert created["quote_currency"] == SEED_DEFAULT_CURRENCY
    assert Decimal(created["rate"]) == Decimal("0.37500000")
    assert created["effective_at"] is not None

    r = await api.get("/api/v1/exchange-rates", headers=auth_headers)
    assert r.status_code == 200
    assert any(row["id"] == created["id"] for row in r.json())


async def test_create_rate_lowercase_is_normalized(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await _put_rate(api, auth_headers, "gbp", "0.38000000", quote="kwd")
    assert created["base_currency"] == "GBP"
    assert created["quote_currency"] == "KWD"


async def test_create_rate_base_equals_quote_400(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await api.post(
        "/api/v1/exchange-rates",
        json={"base_currency": "KWD", "quote_currency": "kwd", "rate": "1"},
        headers=auth_headers,
    )
    assert r.status_code == 400


async def test_create_rate_nonpositive_400(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    for bad in ("0", "-0.5"):
        r = await api.post(
            "/api/v1/exchange-rates",
            json={"base_currency": "AED", "quote_currency": "KWD", "rate": bad},
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text


async def test_create_rate_duplicate_effective_at_409(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    at = _random_past_at()
    await _put_rate(api, auth_headers, "AED", "0.08300000", effective_at=at)
    r = await api.post(
        "/api/v1/exchange-rates",
        json={
            "base_currency": "AED",
            "quote_currency": SEED_DEFAULT_CURRENCY,
            "rate": "0.08400000",
            "effective_at": at,
        },
        headers=auth_headers,
    )
    assert r.status_code == 409


# ── FX on payment writes ────────────────────────────────────────────


async def test_manual_payment_same_currency_rate_one(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "amount": "20.00",
            "currency": SEED_DEFAULT_CURRENCY,
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert Decimal(body["exchange_rate"]) == Decimal("1")
    assert Decimal(body["amount_in_default_currency"]) == Decimal("20.00")


async def test_manual_payment_with_rate_converts(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # Inserted at NOW -> always the most recent USD rate, rerun-safe.
    await _put_rate(api, auth_headers, "USD", "0.30750000")
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "amount": "100.00",
            "currency": "USD",
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert Decimal(body["exchange_rate"]) == Decimal("0.30750000")
    # 100.00 * 0.30750000 = 30.75
    assert Decimal(body["amount_in_default_currency"]) == Decimal("30.75")


async def test_manual_payment_most_recent_rate_wins(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # Historical loser vs a winner inserted at NOW — nothing (including
    # leftovers from earlier runs) can be more recent than the winner.
    await _put_rate(api, auth_headers, "EUR", "0.20000000", effective_at=_random_past_at())
    await _put_rate(api, auth_headers, "EUR", "0.40000000")
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "amount": "10.00",
            "currency": "EUR",
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["exchange_rate"]) == Decimal("0.40000000")
    assert Decimal(r.json()["amount_in_default_currency"]) == Decimal("4.00")


async def test_manual_payment_without_rate_leaves_fx_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments",
        json={
            "donor_id": donor_id,
            "amount": "50.00",
            "currency": "EGP",  # reserved: no test ever records an EGP rate
            "payment_method": "cash",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["exchange_rate"] is None
    assert body["amount_in_default_currency"] is None


async def test_initiate_without_rate_fails_closed(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "25.00", "currency": "EGP"},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert "No exchange rate configured" in r.json()["detail"]
    assert "EGP" in r.json()["detail"]
    # Fail-closed means NO dangling pending row either.
    rows = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    assert rows.json()["total"] == 0


async def test_initiate_with_rate_sets_fx(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    await _put_rate(api, auth_headers, "SAR", "0.08200000")
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "200.00", "currency": "SAR"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    payment_id = r.json()["payment_id"]
    rows = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    row = next(p for p in rows.json()["items"] if p["id"] == payment_id)
    assert Decimal(row["exchange_rate"]) == Decimal("0.08200000")
    # 200.00 * 0.082 = 16.40
    assert Decimal(row["amount_in_default_currency"]) == Decimal("16.40")


async def test_admin_initiate_on_behalf_without_rate_fails_closed(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": donor_id, "amount": "25.00", "currency": "EGP"},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert "No exchange rate configured" in r.json()["detail"]
    rows = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    assert rows.json()["total"] == 0


async def test_admin_initiate_on_behalf_same_currency_rate_one(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    r = await api.post(
        "/api/v1/payments/admin/initiate-on-behalf",
        json={"donor_id": donor_id, "amount": "12.50", "currency": SEED_DEFAULT_CURRENCY},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    payment_id = r.json()["payment_id"]
    rows = await api.get(f"/api/v1/payments?donor_id={donor_id}", headers=auth_headers)
    row = next(p for p in rows.json()["items"] if p["id"] == payment_id)
    assert Decimal(row["exchange_rate"]) == Decimal("1")
    assert Decimal(row["amount_in_default_currency"]) == Decimal("12.50")


# ── Sponsorship currency pin ────────────────────────────────────────


async def test_sponsorship_currency_pinned_to_org_default(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "start_date": "2026-07-01",
            # no currency at all -> pinned to the org default
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["currency"] == SEED_DEFAULT_CURRENCY


async def test_sponsorship_matching_currency_accepted(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "currency": SEED_DEFAULT_CURRENCY.lower(),  # echo, any case
            "start_date": "2026-07-01",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["currency"] == SEED_DEFAULT_CURRENCY


async def test_sponsorship_foreign_currency_rejected(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor_id = await _make_donor(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers)
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "currency": "USD",
            "start_date": "2026-07-01",
        },
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    assert SEED_DEFAULT_CURRENCY in r.json()["detail"]
