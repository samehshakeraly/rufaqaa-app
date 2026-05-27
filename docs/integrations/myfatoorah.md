# MyFatoorah integration

Rufaqaa uses [MyFatoorah](https://myfatoorah.com/) as the card processor for donor-facing payments. The integration is two-way:

- **Outbound:** the backend calls MyFatoorah's `SendPayment` API to mint a hosted-checkout URL that we redirect the donor to.
- **Inbound:** MyFatoorah calls our `POST /api/v1/webhooks/myfatoorah` endpoint to tell us how each charge ended.

Card data is **never** entered into Rufaqaa. The donor types it on MyFatoorah's PCI-compliant hosted page; we only ever see the resulting InvoiceId and amount.

## 1. Getting a sandbox key

1. Sign up at <https://portal.myfatoorah.com/En/signup/registeruser>.
2. After verification, log in to the **Test / Sandbox** portal at <https://portal.myfatoorah.com/En/Login/TestAccount>.
3. Go to **Integration Settings → API Key Configuration**.
4. Copy your **Test API Key** (long JWT).
5. Set up a webhook URL pointing at your deployment's `https://<your-host>/api/v1/webhooks/myfatoorah` and copy the **Webhook Secret** the portal generates.

For production, repeat against <https://portal.myfatoorah.com/En/Login> and use your live keys. **Never commit either key to git.**

## 2. Environment variables

| Variable | Sandbox default | Production |
|---|---|---|
| `MYFATOORAH_API_URL` | `https://apitest.myfatoorah.com` | `https://api.myfatoorah.com` |
| `MYFATOORAH_API_KEY` | (paste sandbox JWT) | (paste live JWT) |
| `MYFATOORAH_WEBHOOK_SECRET` | (paste sandbox secret) | (paste live secret) |
| `APP_BASE_URL` | `http://localhost:5173` | `https://rufaqaa.example.com` |

`APP_BASE_URL` is what we tell MyFatoorah to redirect the donor to after they pay (`/payment/success`) or fail (`/payment/failure`). Make sure it matches the host they actually use — MyFatoorah will reject mismatched redirects when the account is locked down.

When `MYFATOORAH_API_KEY` is unset, every call to `/payments/initiate` returns **502 Bad Gateway** with a clear "MYFATOORAH_API_KEY is not configured" message. Useful for local dev where you don't have a key yet.

## 3. SendPayment — request/response

### Request

`POST https://apitest.myfatoorah.com/v2/SendPayment`

Headers:
```
Authorization: Bearer <MYFATOORAH_API_KEY>
Content-Type: application/json
```

Body (what `app.services.myfatoorah.send_payment` sends):
```json
{
  "InvoiceValue": 25.0,
  "DisplayCurrencyIso": "KWD",
  "CustomerName": "Sameh Shakeraly",
  "CustomerEmail": "donor@example.com",
  "CallBackUrl": "https://rufaqaa.example.com/payment/success?payment_id=<uuid>",
  "ErrorUrl":    "https://rufaqaa.example.com/payment/failure?payment_id=<uuid>",
  "Language": "AR",
  "CustomerReference": "SPN-ABC123",
  "NotificationOption": "LNK"
}
```

`CustomerReference` is the sponsorship code if the payment is for an existing sponsorship, otherwise the internal payment id. The webhook handler uses this value to link the inbound completion back to the right sponsorship.

### Success response

```json
{
  "IsSuccess": true,
  "Message": "",
  "Data": {
    "InvoiceId": 1840734,
    "InvoiceURL": "https://apitest.myfatoorah.com/KWT/ie/...",
    "CustomerReference": "SPN-ABC123",
    "UserDefinedField": null
  }
}
```

We persist `InvoiceId` in `payments.gateway_transaction_id` and redirect the donor's browser to `InvoiceURL`.

### Failure response

```json
{
  "IsSuccess": false,
  "Message": "Invalid InvoiceValue",
  "ValidationErrors": [
    {"Name": "InvoiceValue", "Error": "InvoiceValue is required"}
  ]
}
```

Surfaced as `502 Bad Gateway` to the caller, with the message included in `detail`. An audit row (`action=payment.initiate_failed`) is written and the pending Payment row is rolled back.

## 4. Webhook — what MyFatoorah sends us

`POST https://<your-host>/api/v1/webhooks/myfatoorah`

```json
{
  "Data": {
    "InvoiceId": 1840734,
    "InvoiceStatus": "Paid",
    "InvoiceValue": "25.00",
    "Currency": "KWD",
    "CustomerEmail": "donor@example.com",
    "CustomerReference": "SPN-ABC123"
  }
}
```

`X-MyFatoorah-Signature` header carries an HMAC-SHA256 of the raw body keyed by `MYFATOORAH_WEBHOOK_SECRET`. The backend rejects mismatches with `401`.

`InvoiceStatus` maps to our payment status:

| MyFatoorah | Rufaqaa |
|---|---|
| `Paid` / `Captured` | `completed` |
| `Authorized` | `processing` |
| `Failed` / `Cancelled` / `Expired` | `failed` |

When the gateway reports `Paid` on a payment that's `pending` here, the row flips to `completed` and the linked sponsorship's status moves from `pending` → `active`. The handler is **idempotent** — re-deliveries on the same `InvoiceId` return `{"status": "duplicate"}` without double-writing.

## 5. MakeRefund — request/response

`POST https://apitest.myfatoorah.com/v2/MakeRefund`

Body (`app.services.myfatoorah.make_refund`):
```json
{
  "KeyType": "InvoiceId",
  "Key": "1840734",
  "Amount": 25.0,
  "Comment": "customer requested",
  "RefundChargeOnCustomer": false,
  "ServiceChargeOnCustomer": false
}
```

The admin endpoint `POST /payments/{id}/refund` wraps this. It refuses non-MyFatoorah payments, non-`completed` payments, and refunds larger than the original amount. A full refund moves the row to `refunded`; a partial refund moves it to `partially_refunded`.

## 6. Security

- We never log card data. `app.services.myfatoorah._post` strips any `CardNumber`, `CVV`, `ExpiryDate` keys before structlog emits the request payload. This is defence in depth — our codebase never passes these keys in the first place.
- The webhook secret in transit MUST be HTTPS in production.
- Sandbox keys are useless against real money. Keep production keys in a secrets manager, never in `.env.example` or any committed file.
- See [`SECURITY.md`](../../SECURITY.md) for the broader security posture.

## 7. Manually testing the full loop

With the dev stack running (`make up`) and a sandbox key configured:

```bash
# 1. Get an access token
TOKEN=$(curl -sX POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dev.rufaqaa.app","password":"admin12345"}' | jq -r .access_token)

# 2. List donors to grab a donor_id
DONOR=$(curl -s http://localhost:8000/api/v1/donors -H "Authorization: Bearer $TOKEN" | jq -r .items[0].id)

# 3. Initiate
curl -sX POST http://localhost:8000/api/v1/payments/initiate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"donor_id\":\"$DONOR\",\"amount\":\"25.00\",\"currency\":\"KWD\"}"
# → {"payment_id":"...", "invoice_id":"...", "payment_url":"https://apitest..."}
```

Open `payment_url` in a browser, enter MyFatoorah's test card (`5123 4500 0000 0008`, any future expiry, CVV `100`) — you'll be redirected to `/payment/success` and the matching `payments` row will be `completed`.

To trigger a refund:

```bash
curl -sX POST "http://localhost:8000/api/v1/payments/$PAYMENT_ID/refund" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"amount":"25.00","reason":"test refund"}'
```

---

## Refund webhooks (asynchronous)

The synchronous `POST /payments/{id}/refund` above takes effect when
the gateway responds; in practice MyFatoorah may also send an
**asynchronous** refund status update later (e.g. a card-network
delay). The same `POST /webhooks/myfatoorah` endpoint handles those.

### Detection

A delivery is treated as a refund event when the payload (under
`Data`) contains any of:

- `RefundStatus` (`Refunded`, `FullyRefunded`, `PartiallyRefunded`, `RefundFailed`)
- `RefundReference` — the gateway's refund id
- `IsRefunded: true`
- `EventType` matching `*refund*` (case-insensitive)

### Behaviour

The existing payment row is found by `gateway_transaction_id`. If
unknown, the webhook 404s (the operator can replay the original
payment delivery first, then replay the refund). On a match:

| RefundStatus | New payment.status |
| --- | --- |
| Refunded / FullyRefunded | `refunded` |
| PartiallyRefunded | `partially_refunded` |
| RefundFailed / Failed | `failed` |
| _unknown but `IsRefunded=true` or `RefundAmount ≥ amount`_ | `refunded` |
| _unknown but `RefundAmount > 0`_ | `partially_refunded` |
| _otherwise_ | `failed` |

Sponsorship totals are **only** reversed when a previously-`completed`
payment is now **fully** `refunded`. Partial refunds leave the
sponsorship books alone — the adjustment lives on the payment row.

Duplicate deliveries (same `gateway_transaction_id`, same new status)
return `{"status": "duplicate", ...}` and do not double-adjust totals.

### Replay

Every refund event is logged into `inbound_webhook_log` like any other
inbound delivery. From the admin UI, "Replay" against a failed refund
attempt re-runs the handler; the partial-refund accumulator only
moves forward (we never re-add funds we already subtracted).

---

## Admin-initiated checkout (walk-in donors)

For the elderly walk-in donor scenario, the admin starts a hosted
checkout *on behalf of* an existing donor:

```bash
curl -sX POST http://localhost:8000/api/v1/payments/admin/initiate-on-behalf \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"donor_id\":\"$DONOR_ID\",\"amount\":\"50.00\",\"currency\":\"KWD\",\"language\":\"ar\"}"
# → {"payment_id":"...", "invoice_id":"...", "payment_url":"https://apitest..."}
```

The `payments` row records `initiated_by_user_id = <admin id>` in
addition to `donor_id`. The webhook flip-to-`completed` is unchanged;
the receipt email goes to the donor's address (locale picked from the
donor's country).

See `docs/admin/walk-in-donors.md` for the operator runbook.
