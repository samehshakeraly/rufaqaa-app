"""PR-W01 — the orphans waqf as a general pool donation.

No new model and no migration: the waqf is an ordinary payment tagged
with ``target_type='waqf'`` and carrying NO sponsorship and NO orphan.
These tests pin that contract end to end — the tag reaches the row, the
mutually-exclusive rule is enforced, existing flows keep a NULL column,
and the completion webhook treats a waqf row like any other payment.

The MyFatoorah service is monkey-patched (same ``fake_gateway`` shape as
test_payment_initiate.py) so nothing here touches the network.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session
from app.services import myfatoorah


def _sign(body: bytes) -> str:
    return hmac.new(
        (settings.MYFATOORAH_WEBHOOK_SECRET or "").encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()


def _hmac_headers(body: bytes) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.MYFATOORAH_WEBHOOK_SECRET:
        headers["X-MyFatoorah-Signature"] = _sign(body)
    return headers


@pytest.fixture
def fake_gateway(monkeypatch):
    """Stub the MyFatoorah HTTP calls so initiate runs end-to-end against
    the real DB. Per-test uuid prefix so repeated runs never collide on
    gateway_transaction_id."""
    state: dict = {"prefix": uuid.uuid4().hex[:8], "invoice_counter": 0}

    async def _fake_send_payment(**kw):
        state["invoice_counter"] += 1
        invoice_id = f"{state['prefix']}-{state['invoice_counter']}"
        return myfatoorah.SendPaymentResult(
            invoice_id=invoice_id,
            payment_url=f"https://apitest.myfatoorah.com/checkout/{invoice_id}",
            raw={"InvoiceId": invoice_id},
        )

    monkeypatch.setattr(myfatoorah, "send_payment", _fake_send_payment)
    return state


async def _signup_donor(
    api: AsyncClient,
    admin_headers: dict[str, str],
) -> tuple[str, str, dict[str, str]]:
    """Create an org-scoped donor + a linked, email-verified donor user.

    Returns (donor_id, donor_email, donor auth headers). Same dance as
    test_payments_donor.py: the admin create endpoint keeps the donor in
    the admin's org, and accepting the invite is what marks the user's
    email verified — which /payments/initiate requires of a donor.
    """
    suffix = uuid.uuid4().hex[:8]
    email = f"waqf-{suffix}@example.com"
    password = "longenoughpw1"

    r = await api.post(
        "/api/v1/donors",
        json={"full_name": f"Waqf Donor {suffix}", "email": email},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    donor_id = str(r.json()["id"])

    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "Waqf", "last_name": "Donor", "role": "donor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = str(r.json()["user"]["id"])

    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()

    return donor_id, email, headers


async def _payment_row(payment_id: str) -> dict[str, object]:
    """Read the stored columns directly — target_type is deliberately
    absent from the staff-facing PaymentRead payload, so the row itself
    is the only honest assertion target."""
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT target_type, sponsorship_id, orphan_id, status "
                    "FROM payments WHERE id = :pid"
                ),
                {"pid": payment_id},
            )
        ).one()
    return {
        "target_type": row[0],
        "sponsorship_id": row[1],
        "orphan_id": row[2],
        "status": row[3],
    }


async def test_waqf_initiate_tags_the_row_and_links_no_child(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id, _, donor_headers = await _signup_donor(api, auth_headers)

    r = await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": donor_id,
            "amount": "50.00",
            "currency": "KWD",
            "target_type": "waqf",
        },
        headers=donor_headers,
    )
    assert r.status_code == 201, r.text
    payment_id = r.json()["payment_id"]

    row = await _payment_row(payment_id)
    assert row["target_type"] == "waqf"
    assert row["sponsorship_id"] is None
    assert row["orphan_id"] is None


async def test_waqf_with_a_sponsorship_is_422(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    """The waqf is a pool, not a kafala — the two can never be one row."""
    donor_id, _, donor_headers = await _signup_donor(api, auth_headers)

    r = await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": donor_id,
            "amount": "50.00",
            "currency": "KWD",
            "target_type": "waqf",
            "sponsorship_id": str(uuid.uuid4()),
        },
        headers=donor_headers,
    )
    assert r.status_code == 422, r.text


async def test_waqf_with_an_orphan_is_422(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id, _, donor_headers = await _signup_donor(api, auth_headers)

    r = await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": donor_id,
            "amount": "50.00",
            "currency": "KWD",
            "target_type": "waqf",
            "orphan_id": str(uuid.uuid4()),
        },
        headers=donor_headers,
    )
    assert r.status_code == 422, r.text


async def test_initiate_without_target_type_leaves_the_column_null(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    """Regression guard: the existing one-off donation flow is untouched."""
    donor_id, _, donor_headers = await _signup_donor(api, auth_headers)

    r = await api.post(
        "/api/v1/payments/initiate",
        json={"donor_id": donor_id, "amount": "12.00", "currency": "KWD"},
        headers=donor_headers,
    )
    assert r.status_code == 201, r.text

    row = await _payment_row(r.json()["payment_id"])
    assert row["target_type"] is None


async def test_webhook_completes_a_waqf_payment_like_any_other(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    donor_id, donor_email, donor_headers = await _signup_donor(api, auth_headers)

    r = await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": donor_id,
            "amount": "75.00",
            "currency": "KWD",
            "target_type": "waqf",
        },
        headers=donor_headers,
    )
    assert r.status_code == 201, r.text
    payment_id = r.json()["payment_id"]
    invoice_id = r.json()["invoice_id"]

    body = json.dumps(
        {
            "Data": {
                "InvoiceId": invoice_id,
                "InvoiceStatus": "Paid",
                "InvoiceValue": "75.00",
                "Currency": "KWD",
                "CustomerEmail": donor_email,
            }
        }
    ).encode("utf-8")
    r = await api.post(
        "/api/v1/webhooks/myfatoorah",
        content=body,
        headers=_hmac_headers(body),
    )
    assert r.status_code == 200, r.text

    row = await _payment_row(payment_id)
    assert row["status"] == "completed"
    # Completion must not disturb the tag — the donor's waqf total is
    # derived from exactly this pair (completed + target_type).
    assert row["target_type"] == "waqf"


async def test_donor_sees_target_type_on_their_own_payments(
    api: AsyncClient, auth_headers: dict[str, str], fake_gateway
) -> None:
    """The donor-safe projection carries the tag, so the portal can total
    "my waqf" without a second endpoint."""
    donor_id, _, donor_headers = await _signup_donor(api, auth_headers)

    await api.post(
        "/api/v1/payments/initiate",
        json={
            "donor_id": donor_id,
            "amount": "20.00",
            "currency": "KWD",
            "target_type": "waqf",
        },
        headers=donor_headers,
    )

    r = await api.get("/api/v1/me/payments?limit=50", headers=donor_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["target_type"] == "waqf"
