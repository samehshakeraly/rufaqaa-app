# Notifications & email delivery

Where every outbound email originates and what guarantees we make about
re-delivery.

## Channels

We have one channel today: SMTP, behind `app.services.email.send_email`.
In development, the docker-compose stack ships a MailHog container at
`http://localhost:8025` so outgoing messages are visible without a real
relay. With `EMAIL_ENABLED=false` (the default) the sender logs the
message via `structlog` and returns `False` — useful for tests and
offline dev.

Templates live in `app.services.email_templates` keyed by
`(name, locale)`. Every template has an Arabic and English variant.
The `send_templated(template=..., locale=..., **vars)` shim is the
preferred entry point.

## Trigger inventory

| When | Template | Where | Locale source |
| --- | --- | --- | --- |
| Donor signs up | `donor_welcome` | `app/api/v1/auth.py::signup` | request payload (`preferred_language`) |
| Donor needs to verify email | `donor_email_verification` | `app/api/v1/auth.py::request_email_verify` | user.language |
| Donor confirms email | `donor_email_verified` | `app/api/v1/auth.py::verify_email` | user.language |
| Forgot-password request | `password_reset` | `app/api/v1/auth.py::forgot_password` | `settings.DEFAULT_LOCALE` |
| MyFatoorah `Paid` webhook → payment row flips to `completed` | `payment_succeeded` | `app/api/v1/webhooks.py::_process_myfatoorah_payload` | donor.country_of_residence (`en` for US/GB/CA, else `ar`) |
| Daily org digest | `daily_digest` | `app/workers/tasks/digest.py::send_daily_digest` (Celery beat) | org default (`ar`) |
| Report transitions to `published_to_donor` | _no template — plain-text email_ | `app/workers/tasks/notifications.py::notify_donors_of_report` (Celery) | n/a — bilingual body baked in |

Operators can grep for `send_templated(` to find every site in seconds.

## Asynchronous tasks

The publish-time fan-out for orphan reports goes through Celery so the
HTTP request can return immediately:

1. `POST /reports/{id}/publish` succeeds → `notify_donors_of_report.delay(report_id)` (best-effort; broker outage is logged but doesn't fail the publish).
2. The task loads every active/paused/overdue sponsorship for the orphan, fetches each donor's email, sends `"A new report is available"` to each.
3. **Idempotency:** the task checks `orphan_reports.donors_notified_at IS NULL` before sending and stamps the column on success. A retry / replay through the broker is a no-op.

Daily digest follows the same pattern but is fired by Celery beat
(see `app/workers/celery_app.py`); it has no idempotency stamp because
it's keyed on the calendar day implicitly (it always queries the last
24h).

## Webhook-driven sends

`POST /webhooks/myfatoorah` is dual-purpose:

- **Payment success** → if the row flips to `completed` in this
  request, `send_templated("payment_succeeded", …)` is dispatched
  synchronously. Failures are swallowed (a logging email must never
  break the webhook itself; the gateway would retry).
- **Refund events** (`RefundStatus`, `RefundReference`, `IsRefunded`,
  `EventType=Refund*`) are routed to `_process_refund_event` which
  updates the payment status but does **not** currently send an email.
  When that's wanted, add a `payment_refunded` template + a call at
  the bottom of `_process_refund_event`.

## Failure modes

- **SMTP down**: `send_email` raises; the webhook path swallows it
  (`# noqa: BLE001 — never let a logging email block the webhook`),
  the auth paths bubble it as 500. Acceptable trade-off because the
  underlying business write has already committed.
- **Donor missing email**: skipped silently (`if d.email` guard in
  the worker helpers).
- **Celery broker down**: `.delay()` raises in `publish_report`; the
  publish endpoint catches and returns success. Operators replay by
  re-publishing (idempotency stamp prevents double-send when the broker
  comes back).

## When to add a new email

1. Add the bilingual template in `app/services/email_templates.py`
   (subject + body, `str.format` placeholders).
2. Add a unit test in `tests/unit/test_email_templates.py`.
3. Pick the dispatch site, call `send_templated`, choose the locale
   based on the relevant identity (donor → country/preference; staff →
   org default).
4. Add a row to the inventory table above.
5. If the trigger is in a hot path, dispatch via Celery instead and
   add an idempotency stamp.
