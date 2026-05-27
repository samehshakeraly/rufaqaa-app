"""MyFatoorah payment gateway client.

Wraps the two endpoints we actually consume — SendPayment to mint a
hosted checkout URL and MakeRefund to reverse a completed payment.

Sandbox vs production is a config switch (`MYFATOORAH_API_URL`). We do
NOT see card data — the donor enters it at MyFatoorah's hosted page;
our server only sees the resulting InvoiceId.

Errors from the gateway are surfaced as `MyFatoorahError(message,
status_code, code, raw)` so the calling endpoint can map them to a 502
without leaking implementation details.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)


class MyFatoorahError(Exception):
    """Raised when MyFatoorah returns a non-success response or the
    request itself fails (timeout, DNS, 5xx)."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        code: str | None = None,
        raw: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.raw = raw


@dataclass(frozen=True)
class SendPaymentResult:
    invoice_id: str
    payment_url: str
    raw: dict[str, Any]


@dataclass(frozen=True)
class RefundResult:
    refund_id: str
    raw: dict[str, Any]


def _headers() -> dict[str, str]:
    if not settings.MYFATOORAH_API_KEY:
        raise MyFatoorahError("MYFATOORAH_API_KEY is not configured")
    return {
        "Authorization": f"Bearer {settings.MYFATOORAH_API_KEY}",
        "Content-Type": "application/json",
    }


async def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POST to MyFatoorah and return the parsed `Data` field on success.
    Raises MyFatoorahError on any failure. Caller's payload is logged
    WITHOUT card-like fields (we never receive them, but defence in depth)."""
    url = f"{settings.MYFATOORAH_API_URL.rstrip('/')}{path}"
    safe_log_payload = {
        k: v
        for k, v in payload.items()
        # belt-and-suspenders — we never pass these keys, but if a future
        # caller does we don't want them in stdout
        if k.lower() not in {"cardnumber", "cvv", "expirydate", "card_number"}
    }
    logger.info("myfatoorah_request", path=path, payload=safe_log_payload)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json=payload, headers=_headers())
    except httpx.HTTPError as exc:
        logger.warning("myfatoorah_transport_error", path=path, error=str(exc))
        raise MyFatoorahError(f"Could not reach MyFatoorah: {exc}", status_code=None) from exc

    try:
        body = response.json()
    except ValueError as exc:
        raise MyFatoorahError(
            f"MyFatoorah returned non-JSON ({response.status_code})",
            status_code=response.status_code,
            raw=response.text,
        ) from exc

    if not body.get("IsSuccess"):
        # MyFatoorah responses on failure look like
        #   {"IsSuccess": false, "Message": "...", "ValidationErrors": [...]}
        message = body.get("Message") or "MyFatoorah rejected the request"
        validation = body.get("ValidationErrors") or []
        if validation:
            message = f"{message}: {validation}"
        logger.warning(
            "myfatoorah_business_error",
            path=path,
            status=response.status_code,
            message=message,
        )
        raise MyFatoorahError(
            message,
            status_code=response.status_code,
            code=str(body.get("ErrorCode") or ""),
            raw=body,
        )

    return body.get("Data") or {}


async def send_payment(
    *,
    amount: Decimal,
    currency: str,
    customer_name: str,
    customer_email: str | None,
    customer_reference: str,
    callback_url: str,
    error_url: str,
    customer_phone: str | None = None,
    language: str = "ar",
) -> SendPaymentResult:
    """Mint a hosted checkout URL for the donor to pay with their card.

    `customer_reference` should be a stable ID we can match in the
    webhook callback (typically `Sponsorship.code` or `Payment.id`)."""
    payload: dict[str, Any] = {
        "InvoiceValue": float(amount),
        "DisplayCurrencyIso": currency,
        "CustomerName": customer_name,
        "CustomerEmail": customer_email,
        "CallBackUrl": callback_url,
        "ErrorUrl": error_url,
        "Language": language.upper(),
        "CustomerReference": customer_reference,
        # Whether MyFatoorah emails the invoice to the donor — we want
        # our own bilingual emails, not theirs.
        "NotificationOption": "LNK",
    }
    if customer_phone:
        payload["MobileCountryCode"] = ""
        payload["CustomerMobile"] = customer_phone

    data = await _post("/v2/SendPayment", payload)
    invoice_id = str(data.get("InvoiceId") or "")
    payment_url = str(data.get("InvoiceURL") or "")
    if not invoice_id or not payment_url:
        raise MyFatoorahError("MyFatoorah SendPayment returned no InvoiceId / InvoiceURL", raw=data)
    return SendPaymentResult(invoice_id=invoice_id, payment_url=payment_url, raw=data)


async def make_refund(*, invoice_id: str, amount: Decimal, reason: str) -> RefundResult:
    payload: dict[str, Any] = {
        "KeyType": "InvoiceId",
        "Key": invoice_id,
        "Amount": float(amount),
        "Comment": reason,
        "RefundChargeOnCustomer": False,
        "ServiceChargeOnCustomer": False,
    }
    data = await _post("/v2/MakeRefund", payload)
    refund_id = str(data.get("RefundReference") or data.get("RefundId") or "")
    return RefundResult(refund_id=refund_id, raw=data)
