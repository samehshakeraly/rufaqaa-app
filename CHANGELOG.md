# 📝 سجل التغييرات

> All notable changes to Rufaqaa will be documented here.

This project adheres to [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/) format.

---

## [Unreleased]

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
