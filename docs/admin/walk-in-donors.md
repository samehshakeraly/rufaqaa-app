# Walk-in donor checkout (admin-initiated MyFatoorah)

Some donors — typically older or less technical — show up in person to
make a contribution. They don't want to sign up on the web; they want
to hand over a card or tap their phone and be done. This page is the
operator runbook for the flow.

## Why a separate flow

The regular `POST /payments/initiate` requires the caller to be the
donor (`donor.user_id == current_user.id`) and have a verified email.
A walk-in donor has neither — they may not even have an account.

`POST /payments/admin/initiate-on-behalf` solves this by letting an
admin start a hosted-checkout session against an existing donor row.
The Payment row records both identities:

- `donor_id` — the real beneficiary, who pays.
- `initiated_by_user_id` — the admin who launched the session.

The same MyFatoorah webhook flips the row to `completed` when the
gateway confirms; there is no separate completion path.

## Step-by-step

1. **Identify the donor.** From the admin Donors page, confirm the
   walk-in already has a record. If not, create one (full name + an
   email/phone if you have it) before proceeding.

2. **Open the walk-in checkout page.** From the admin payments list,
   click "Admin checkout (walk-in donor)" or navigate directly to
   `/admin/payments/walk-in`.

3. **Fill in the form.**
   - **Donor** — pick from the dropdown.
   - **Amount** — decimal (no currency symbol).
   - **Currency** — three-letter ISO (KWD, USD, …).
   - **Language** — `ar` or `en`; this controls the MyFatoorah hosted
     page locale, not the receipt email locale (the receipt locale is
     picked from the donor's country).

4. **Hand the checkout to the donor.** The result panel renders:
   - A QR code — for donors who'd rather pay from their own phone.
   - The hosted-checkout URL — copyable, openable in this tab.

   On a kiosk screen, "Open hosted-checkout page" is the smoothest
   path. The donor enters card details on MyFatoorah's page; we never
   see the card number.

5. **Wait for completion.** The page polls `/payments/{id}/receipt`
   every 4 seconds and updates the status badge. Terminal states stop
   the polling automatically:
   - `completed` — the gateway has charged the card. The donor gets a
     bilingual `payment_succeeded` receipt email automatically.
   - `failed` — show the donor the failure, offer to retry.
   - `refunded` / `partially_refunded` — only relevant if a chargeback
     comes through right then; in practice you'll see this on later
     re-visits.

6. **Print or email the receipt.** From the payment row, "Receipt"
   opens `/admin/payments/{id}/receipt`. The donor can take a paper
   copy; the receipt email already went to their address if we have
   one on file.

## What to do if the QR / URL doesn't work

- The hosted-checkout URL is valid for 30 minutes. If the donor takes
  longer, click "Start another checkout" to generate a fresh session.
- If the gateway returns 502 (the page shows the gateway message),
  treat it as a transient outage — the row is rolled back and an
  `payment.admin_initiate_failed` audit entry is recorded so it's
  visible to org admins.

## Audit trail

Every walk-in checkout produces an audit entry:

| action | is_sensitive | entity | new_values |
| --- | --- | --- | --- |
| `payment.admin_initiated_on_behalf` | yes | `payment` | donor_id, invoice_id, amount, currency |
| `payment.admin_initiate_failed` | no | `donor` | detail, amount |

The webhook flip-to-`completed` produces `webhook.myfatoorah.received`
as usual; the receipt email is logged via `structlog`.

## Security & compliance

- Card data **never** touches our server — the hosted-checkout page
  is MyFatoorah's. Our server only sees the invoice_id and the final
  status.
- The route requires the `org_admin` / `super_admin` role; donors and
  rank-and-file staff cannot reach it.
- The session POST is recorded in the inbound webhook log when the
  gateway calls us back (so a replay is possible from the admin UI).
