# Donor portal — user guide

What a brand-new donor sees and does, end-to-end.

## 1. Landing on the site

The homepage at `/` shows the hero, a live count of orphans waiting / sponsored / donors / countries (from `GET /public/stats`), and three CTAs:

- **Browse orphans** → `/orphans`
- **Sign up** → `/signup`
- **Sign in** → `/login` (if you already have an account)

Logged-in users (donor or staff) are redirected to their area instead of seeing the landing.

## 2. Browsing orphans

`/orphans` is anonymous-safe. The cards show only:

- Code (e.g. `ORP-AB12CD`)
- First name (no surname)
- Age in years (computed from DOB on the server — exact date of birth is **not** exposed)
- Gender
- Country
- Partner organization name (if any)

You can filter by country and gender. Clicking a card opens `/orphans/<code>` with the same fields plus an optional short description.

The "Sponsor this child" button is **auth-aware**:

| State | Sponsor button goes to |
|---|---|
| Anonymous | `/signup?intent=sponsor:<code>` — your sponsor intent is preserved through email verification |
| Logged-in, unverified donor | `/verify-email` |
| Logged-in, verified donor | `/sponsor/<code>/checkout` |

## 3. Signing up

`/signup` collects:

- Full name (required)
- Email (required, must be unique)
- Password (min 8 chars; UI shows weak/okay/strong)
- Phone (optional)
- Country, currency, language (defaults to KW / KWD / ar)
- Terms-of-service checkbox (required)

On submit, the backend:

1. Creates a `User` (role=`donor`, status=`pending_verification`)
2. Creates a linked `Donor` row
3. Sends bilingual welcome + verification emails
4. Returns 201 with a generic "check your inbox" message (no email enumeration — same shape if the address is already registered)

In non-production environments, the response also includes `debug_verify_token` so end-to-end tests can follow the link without an email server.

## 4. Email verification

The signup response redirects you to `/verify-email`. From there:

- In production: open the verification link in your email; you land on `/verify-email/confirm?token=…`, which calls `POST /auth/verify-email`, sets your auth tokens, and forwards you to `/donor/dashboard` (or `/sponsor/<code>/checkout` if you signed up with an intent).
- In development: the page auto-uses the `debug_verify_token` stashed in `sessionStorage` and you go straight to the dashboard.

`POST /auth/resend-verification` is also exposed; it returns the same generic shape whether or not the email is registered.

## 5. Donor area

Once verified, the routes under `/donor/*` and `/sponsor/<code>/checkout` are reachable. The chrome is the `DonorLayout`:

- **`/donor/dashboard`** — welcome, sponsorship + payment stats, recent activity
- **`/donor/profile`** — edit name / phone / country / currency (email is immutable from this page; password change happens via `/forgot-password`)
- **`/donor/sponsorships`** — full sponsorship table with a "Pay" link for any `pending` row

## 6. Sponsoring

`/sponsor/<code>/checkout` is the donor's payment kickoff page. It does **not** show a donor dropdown — the current logged-in donor is automatically the payer (the backend rejects any attempt to initiate for another donor with HTTP 403). The donor enters an amount and currency, hits "Pay now", and the browser redirects to MyFatoorah's hosted checkout.

After payment:

- `/payment/success?payment_id=<uuid>` — confirmation + "Download receipt" link to `/admin/payments/<id>/receipt` (open even for donors via the public detail of their own payment).
- `/payment/failure?payment_id=<uuid>` — clear error + "Try again" CTA.

The backend's webhook handler (`POST /webhooks/myfatoorah`) flips the pending `Payment` row to `completed` and activates a `pending` linked `Sponsorship`.

## 7. Account management

- **Forgot password**: standard flow at `/forgot-password` → email link → `/reset-password?token=…`
- **Logout**: top-right button in the donor layout
- **Data export (GDPR Art. 15)**: `POST /donor/me/data-export-request` — returns 202; full implementation is a separate work item
- **Account deletion (GDPR Art. 17)**: `POST /donor/me/deletion-request` — returns 202; requires admin review

## 8. What donors cannot do

- Reach the admin area (`/admin/*` redirects them away)
- See other donors' data (every `/donor/me/*` endpoint scopes by `donor.user_id == current_user.id`)
- Sponsor orphans that aren't in a browseable case status (`available`, `approved`, `reserved`)
- Initiate a payment before verifying their email (HTTP 403)
