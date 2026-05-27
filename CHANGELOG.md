# 📝 سجل التغييرات

> All notable changes to Rufaqaa will be documented here.

This project adheres to [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/) format.

---

## [Unreleased]

### Polish & gap-filling (PR #7)

#### Added
- **Backend**
  - `donors_notified_at` column on `orphan_reports` (migration 0003) gates the Celery `notify_donors_of_report` task so a duplicate run doesn't re-email donors.
  - Webhook payment-success path now dispatches the bilingual `payment_succeeded` receipt email (locale picked from donor's country).
  - `POST /webhooks/myfatoorah` handles refund events (`Refunded`, `PartiallyRefunded`, `RefundFailed`) by flipping the existing payment row; sponsorship totals are reversed only on a full refund of a previously-completed payment. Duplicate refund deliveries are idempotent.
  - `POST /bank-transfers/{id}/confirm-receipt` accepts `confirmation_document_id` + `notes`; `confirmation_document_id` exposed on `GET` responses (migration 0005).
  - `POST /payments/admin/initiate-on-behalf` (admin-only) — walk-in donor flow that records both the real `donor_id` and the admin `initiated_by_user_id` (migration 0004 + partial index).
  - `POST /media/file` — generic staff-only multipart upload; returns the s3:// URL + metadata so the frontend's two-step attach flow can pass it to a document endpoint.
  - `POST /documents` (no parent) — for attach-elsewhere flows (e.g. bank-transfer proof).
  - `GET/POST /guardians/{id}/documents` — guardians can now own documents directly.

- **Frontend**
  - `DocumentUploadCard` two-step UI mounted on orphan detail (admin) and on every guardian row of the family detail page.
  - `ConfirmReceiptDialog` modal on the bank-transfers page — optional proof upload + notes, calls the upgraded confirm-receipt endpoint.
  - `WalkInCheckoutPage` at `/admin/payments/walk-in` — admin-only checkout for a present donor, with QR code, copy-link, and live status polling every 4 s until `completed`/`failed`/`refunded`.

- **Quality gates**
  - `mypy --strict` is a required CI step (backend job). 94 prior errors fixed; tests excluded from the gate with a documented note.
  - `npm run test:coverage` (vitest v8) added with a scoped starting threshold and HTML coverage artifact uploaded by CI (14-day retention).

- **E2E**
  - 8 new Playwright specs covering: sponsorship-create, report-workflow, bank-transfer-lifecycle, photo-upload, donor-csv-import, family-guardian-create, webhook-replay, forgot-password-full-loop. Shared `e2e/helpers/auth.ts`.

- **Docs**
  - `docs/architecture/notifications.md` — when each email/Celery task fires + idempotency contract.
  - `docs/admin/walk-in-donors.md` — operator runbook for the elderly walk-in checkout flow.
  - `docs/integrations/myfatoorah.md` updated with refund-webhook + admin-on-behalf sections.

#### Changed
- `confirmBankTransferReceipt` lib signature is now `(id, { confirmation_document_id?, notes? })`.
- DocumentType enum in the frontend lib reconciled with backend (`bank_statement`, `school_certificate`, `medical_report`, `photo_id`, `family_record` replaced the earlier guesses).

#### Out of scope (deferred to a later PR)
- MCP server expansion, production deployment, recurring/subscription payments, GDPR data-export pipelines (PR #5 left these as stubs and they remain stubs).

---

### Donor self-service (PR #5 backend + PR #6 frontend)

#### Added
- Public donor signup at `POST /auth/signup` with anti-enumeration response shape
- Email verification: `POST /auth/verify-email`, `POST /auth/resend-verification`
- Public read endpoints under `/public/*` (orphans, orphan detail, stats) — curated card projection only
- Donor self-service endpoints under `/donor/me/*` (profile, sponsorships, payments, GDPR stubs)
- 4 new bilingual email templates: `donor_welcome`, `donor_email_verification`, `donor_email_verified`, `payment_succeeded`
- **9 new frontend pages**:
  - public: `LandingPage`, `PublicOrphansPage`, `PublicOrphanDetailPage`, `SignupPage`, `VerifyEmailPendingPage`, `VerifyEmailConfirmPage`
  - donor area: `DonorDashboardPage`, `DonorProfilePage`, `DonorSponsorshipsPage`
- `PublicLayout` + `DonorLayout` chrome, `DonorRoute` guard
- 4 new Playwright specs: `donor-signup-full-loop`, `donor-full-payment-loop`, `donor-isolation`, `public-orphan-data-leak`
- Docs: `docs/donor-portal.md`, `docs/api/public-endpoints.md`, `docs/architecture/authorization.md`

#### Changed
- All admin SPA pages relocated from `/<resource>` to `/admin/<resource>` to free the root namespace for the public surface
- `/payments/initiate` now enforces donor ownership (`donor.user_id == current_user.id`) and email verification when called by a `role='donor'` user
- `/sponsor/:code/checkout` is donor-only; no donor dropdown — pays as the current authenticated donor
- `/auth/me` response includes `email_verified_at`

### Phase 0 — Project Foundation

#### Added
- 📁 Project repository structure
- 📜 Governance files: README, LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- 🐳 Docker Compose for local development (PostgreSQL 15, Redis 7, MinIO, MailHog, Adminer)
- ⚙️ GitHub Actions initial CI workflow
- 📋 GitHub issue and PR templates
- 🤖 Dependabot configuration
- 📚 Initial documentation structure (`docs/`)
- 🛠️ Makefile with common development commands
- 📦 `.gitignore`, `.editorconfig`, `.gitattributes`

---

## [0.0.0] - 2026-05-24

### Project Inception
- 🌱 Project initiated as an Islamic digital endowment (waqf)
- 📋 Comprehensive analysis completed (6,600+ lines)
- 🗄️ Database schema designed (24 tables)
- 🌐 API specification drafted (50+ endpoints)
- 🤖 MCP tools designed (30+ tools)

---

## Phases Roadmap

- [x] **Phase 0** — Project Foundation
- [ ] **Phase 1** — Database Setup
- [ ] **Phase 2** — Authentication & Users
- [ ] **Phase 3** — Visual Identity & Design System (in parallel)
- [ ] **Phase 4** — Partner Organizations & Marketing Channels
- [ ] **Phase 5** — Orphans Core
- [ ] **Phase 6** — Donors
- [ ] **Phase 7** — Sponsorships Triangle
- [ ] **Phase 8** — Payments & Bank Transfers
- [ ] **Phase 9** — Reports & Media
- [ ] **Phase 10** — Frontend Foundation
- [ ] **Phase 11** — Admin Dashboard
- [ ] **Phase 12** — Donor Portal
- [ ] **Phase 13** — Guardian Portal
- [ ] **Phase 14** — Mobile Apps
- [ ] **Phase 15** — MCP Server
- [ ] **Phase 16** — Communications Channels
- [ ] **Phase 17** — Hardening & Pilot Launch

---

## Versioning Notes

- `0.x.x` — Pre-alpha development
- `1.0.0` — First public stable release
- `1.x.x` — Minor improvements and features
- `2.0.0` — SaaS multi-tenant cloud version
