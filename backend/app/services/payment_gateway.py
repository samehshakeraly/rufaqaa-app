"""Payment-gateway selection seam.

The single extension point between the payment endpoints and concrete
gateway clients. MyFatoorah is the only registered gateway today; later
PRs plug additional gateways (and currency routing) in here without
touching the endpoints again.

Endpoints depend on this module only:

- ``select_gateway`` decides WHICH gateway a new payment uses — its
  return value is what gets persisted on ``Payment.payment_gateway``.
- ``get_gateway`` resolves a persisted gateway name to an adapter.
- Adapters normalise provider errors to ``PaymentGatewayError`` so the
  endpoints' existing 502 mapping stays provider-agnostic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from app.services import myfatoorah
from app.services.myfatoorah import RefundResult, SendPaymentResult

if TYPE_CHECKING:
    from app.models.organization import Organization

__all__ = [
    "MYFATOORAH",
    "MyFatoorahGateway",
    "PaymentGateway",
    "PaymentGatewayError",
    "RefundResult",
    "SendPaymentResult",
    "UnknownGatewayError",
    "get_gateway",
    "select_gateway",
]

MYFATOORAH = "myfatoorah"


class PaymentGatewayError(Exception):
    """Provider-agnostic gateway failure.

    Mirrors the fields of ``MyFatoorahError`` (message / status_code /
    code / raw) so endpoints keep their exact 502 mapping without
    importing a concrete provider's exception type."""

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


class UnknownGatewayError(LookupError):
    """Raised by ``get_gateway`` for a name with no registered adapter.
    Callers map this to their existing 4xx."""


class PaymentGateway(ABC):
    """Contract every gateway adapter implements.

    Method signatures mirror the MyFatoorah client functions exactly —
    including the shared ``SendPaymentResult`` / ``RefundResult``
    dataclasses — so call sites carry over unchanged."""

    name: str

    @abstractmethod
    async def send_payment(
        self,
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
    ) -> SendPaymentResult: ...

    @abstractmethod
    async def make_refund(
        self, *, invoice_id: str, amount: Decimal, reason: str
    ) -> RefundResult: ...


class MyFatoorahGateway(PaymentGateway):
    """Adapter over ``app.services.myfatoorah``.

    Resolves the module functions at call time (attribute lookup on the
    module) rather than binding them at import, so monkeypatching
    ``myfatoorah.send_payment`` / ``myfatoorah.make_refund`` in tests
    keeps working."""

    name = MYFATOORAH

    async def send_payment(
        self,
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
        try:
            return await myfatoorah.send_payment(
                amount=amount,
                currency=currency,
                customer_name=customer_name,
                customer_email=customer_email,
                customer_reference=customer_reference,
                callback_url=callback_url,
                error_url=error_url,
                customer_phone=customer_phone,
                language=language,
            )
        except myfatoorah.MyFatoorahError as exc:
            raise PaymentGatewayError(
                exc.message,
                status_code=exc.status_code,
                code=exc.code,
                raw=exc.raw,
            ) from exc

    async def make_refund(self, *, invoice_id: str, amount: Decimal, reason: str) -> RefundResult:
        try:
            return await myfatoorah.make_refund(invoice_id=invoice_id, amount=amount, reason=reason)
        except myfatoorah.MyFatoorahError as exc:
            raise PaymentGatewayError(
                exc.message,
                status_code=exc.status_code,
                code=exc.code,
                raw=exc.raw,
            ) from exc


# Registry keyed by gateway name — the exact string persisted on
# Payment.payment_gateway. Later PRs register new gateways here and
# nowhere else.
_GATEWAYS: dict[str, PaymentGateway] = {
    MYFATOORAH: MyFatoorahGateway(),
}


def get_gateway(name: str) -> PaymentGateway:
    """Resolve a gateway name (as persisted on ``Payment.payment_gateway``)
    to its adapter. Raises ``UnknownGatewayError`` for anything not
    registered; the caller maps that to its existing 4xx."""
    try:
        return _GATEWAYS[name]
    except KeyError:
        raise UnknownGatewayError(f"Unknown payment gateway: {name!r}") from None


def select_gateway(*, currency: str, org: Organization | None = None) -> str:
    """Decide which gateway a NEW payment should use.

    Today every currency routes to MyFatoorah — this function exists so
    that decision has exactly one home. ``org`` is accepted but unused
    for now: it is the documented hook for a future org-level override
    (callers that already have the Organization loaded pass it; none do
    yet)."""
    # ── EXTENSION POINT: currency → gateway routing ─────────────────
    # A later PR adds the routing table here, e.g.
    #     Gulf ISO codes (KWD, SAR, AED, …)  -> "myfatoorah"
    #     international currencies            -> "stripe"
    # and may consult ``org`` for an organization-level override.
    # Until then, EVERY currency resolves to MyFatoorah.
    # ────────────────────────────────────────────────────────────────
    return MYFATOORAH
