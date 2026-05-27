"""MyFatoorah service module — fully mocked, no network."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.services import myfatoorah


@pytest.fixture(autouse=True)
def _set_api_key(monkeypatch):
    monkeypatch.setattr(settings, "MYFATOORAH_API_KEY", "test_key_xyz")
    monkeypatch.setattr(settings, "MYFATOORAH_API_URL", "https://apitest.myfatoorah.com")


def _stub_response(status_code: int, json_body: dict):
    resp = AsyncMock()
    resp.status_code = status_code
    resp.json = lambda: json_body
    resp.text = str(json_body)
    return resp


async def test_send_payment_returns_invoice_url() -> None:
    with patch("httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.return_value = _stub_response(
            200,
            {
                "IsSuccess": True,
                "Data": {
                    "InvoiceId": 12345,
                    "InvoiceURL": "https://apitest.myfatoorah.com/checkout/xyz",
                },
            },
        )
        result = await myfatoorah.send_payment(
            amount=Decimal("25.00"),
            currency="KWD",
            customer_name="Test Donor",
            customer_email="t@example.com",
            customer_reference="SPN-TEST",
            callback_url="https://x/ok",
            error_url="https://x/fail",
        )
    assert result.invoice_id == "12345"
    assert result.payment_url.startswith("https://apitest")


async def test_send_payment_bubbles_up_validation_error() -> None:
    with patch("httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.return_value = _stub_response(
            422,
            {
                "IsSuccess": False,
                "Message": "Invalid InvoiceValue",
                "ValidationErrors": [{"Name": "InvoiceValue", "Error": "Required"}],
            },
        )
        with pytest.raises(myfatoorah.MyFatoorahError) as exc:
            await myfatoorah.send_payment(
                amount=Decimal("25.00"),
                currency="KWD",
                customer_name="Test",
                customer_email=None,
                customer_reference="x",
                callback_url="https://x/ok",
                error_url="https://x/fail",
            )
    assert exc.value.status_code == 422
    assert "Invalid InvoiceValue" in exc.value.message


async def test_send_payment_treats_transport_failure_as_error(monkeypatch) -> None:
    import httpx as _httpx

    with patch("httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.side_effect = _httpx.ConnectError("network down")
        with pytest.raises(myfatoorah.MyFatoorahError) as exc:
            await myfatoorah.send_payment(
                amount=Decimal("1"),
                currency="KWD",
                customer_name="t",
                customer_email=None,
                customer_reference="x",
                callback_url="https://x/ok",
                error_url="https://x/fail",
            )
    assert "Could not reach" in exc.value.message


async def test_make_refund_returns_reference() -> None:
    with patch("httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.return_value = _stub_response(
            200,
            {
                "IsSuccess": True,
                "Data": {"RefundReference": "RF-123"},
            },
        )
        result = await myfatoorah.make_refund(
            invoice_id="12345", amount=Decimal("10.00"), reason="customer asked"
        )
    assert result.refund_id == "RF-123"


async def test_missing_api_key_errors_before_network(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MYFATOORAH_API_KEY", "")
    with pytest.raises(myfatoorah.MyFatoorahError):
        await myfatoorah.send_payment(
            amount=Decimal("1"),
            currency="KWD",
            customer_name="t",
            customer_email=None,
            customer_reference="x",
            callback_url="https://x/ok",
            error_url="https://x/fail",
        )
