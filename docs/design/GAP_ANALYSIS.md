# Gap analysis — mockups vs live frontend

Source of truth for visual intent: `docs/design/screens/` (51 HTML mockups + design system `rufaqaa-design-system-v0.1.html`).
Source of truth for shipped code: `frontend/src/pages/*.tsx` (35 React pages).

This document is the result of a side-by-side read of every React page against its expected mockup (per the "Expected Route" column in `docs/design/screens/README.md`).

---

## 0. System-level drift (affects every page)

Two design tokens are wrong app-wide; flagging once at the top so the per-page sections can focus on layout/content.

| What | Mockup | React | Effort |
|---|---|---|---|
| Arabic font | `IBM Plex Sans Arabic` (loaded in every mockup `<head>`) | `Noto Sans Arabic` (`frontend/index.html` line 8) | 1 hour — swap the Google Fonts URL + update `tailwind.config.js` font-family stack |
| Latin font | `IBM Plex Sans` | `Inter` | (same fix) |
| Color tokens | Full 9-step ramps: `trust-100 … trust-900`, `gray-50 … gray-900`, `success-50/100/500/600/700`, `warning-*`, `tranquil-100…400`, `snow-50…300` | Only 4 flat tokens: `snow`, `tranquil`, `sky`, `trust` (see `frontend/tailwind.config.js`) | Half day — extend Tailwind theme with the full ramps from `rufaqaa-design-system-v0.1.html` so per-page work can stop using `bg-tranquil/40`, `text-slate-*`, etc. as substitutes for design-system tokens |
| Hover state on primary button | `trust-300 → trust-400 hover → trust-500 active`, `shadow-md` on hover | `bg-trust hover:bg-trust/90`, no shadow elevation | 30 min — update `.btn-primary` in `src/styles/index.css` |
| Card chrome | white bg + `--sky-200` border, but nested panels use `--tranquil-200` | white bg + `border-sky` (correct on outer card; nested panels use `bg-snow` instead of `bg-tranquil/something`) | 1 hour — introduce `.panel` class once the ramps exist |

None of these are blockers; they're the reason "every page looks ~95% right but subtly off" until they're fixed centrally.

---

## 1. Perfect matches

These pages already render the mockup's layout, components, and content sections accurately. Only the system-level drift in §0 separates them from pixel-equivalent.

| Screen | React file | Notes |
|---|---|---|
| **A-03** Password Reset | `pages/ForgotPasswordPage.tsx` + `pages/ResetPasswordPage.tsx` | Centered max-w card, email field, success state with debug-token affordance, separate reset page with new+confirm fields. Layout identical. |
| **D-01** Donor Dashboard | `pages/DonorDashboardPage.tsx` | 3-stat KPI grid + active sponsorships table with `divide-sky/40` rows + browse-more CTA. Matches the mockup's header→stats→table structure. |
| **D-02** Browse Available Orphans | `pages/PublicOrphansPage.tsx` | Two-input filter card (country, gender) + `lg:grid-cols-3` orphan card grid + tranquil card bg + Sponsor CTA on hover. Identical. |
| **D-03** Orphan Detail (Pre-Sponsor) | `pages/PublicOrphanDetailPage.tsx` | Back link, hero with code/age/gender, primary "Sponsor this child" CTA. The mockup has a sticky-footer CTA on mobile; React has an inline button. Functional parity. |
| **D-06** My Orphans (Sponsorships) | `pages/DonorSponsorshipsPage.tsx` | Table with code (mono), orphan, amount, total_paid, status, Pay-button on pending rows. Identical. |
| **OA-01** Executive Dashboard | `pages/DashboardPage.tsx` | KPI stats grid (active, sponsored, available, donors, overdue), `PaymentsChart`, `SponsorshipsDonut`, `PartnerDonationsBar`. Three-chart row + stat-card row matches OA-01's wireframe. |
| **OA-02** Users Management | `pages/UsersPage.tsx` | Users table (name, role, status, last login, actions) + invite form + role/status filters. |
| **OA-03** Partner Organizations | `pages/PartnersPage.tsx` | Partners table (code/name/country/status) + new-partner form + detail-link. Mono codes, sky border row dividers. |
| **OA-07** Audit Log | `pages/AuditPage.tsx` | Timestamp / actor / action / entity / values table. Filtering by action and entity matches the mockup's two-dropdown filter row. |
| **PS-02** Orphans Table | `pages/OrphansPage.tsx` (admin) | Search + status filter + paginated table + bulk-archive + new-orphan form. Column set matches PS-02 exactly. |
| **PS-05** Reports Review | `pages/ReportsPage.tsx` | Period / type / status / actions table; status-gated transition buttons (submit/approve-partner/approve-org/publish/reject). |

**Count: 11 perfect-match pairs.**

---

## 2. Minor drift

Render is ≥80% equivalent but with concrete fixable differences.

### A-01 Shared Login → `pages/LoginPage.tsx`
- Mockup uses a **two-column split layout** (`grid-template-columns: 1fr 1.05fr`) with brand hero/illustration on the left, login form on the right.
- React renders a single centered `.card` on a `bg-tranquil` page. No hero column at any breakpoint.
- Also: mockup's logo is a `trust-300` rounded square + tagline; React's header is just `app.name + tagline` text.
- **Effort: half day** — add a desktop `lg:grid lg:grid-cols-2` wrapper, hide the hero column at `<lg`, add the brand mark.

### A-02 Donor Registration → `pages/SignupPage.tsx`
- Mockup has a **radial gradient backdrop** (`background: radial-gradient(circle at top, tranquil-100, snow-100)`) and a top brand-row.
- React renders a plain `.card` centered with no gradient and no brand mark.
- The mockup signals the multi-field form with a **subtle step pill** (single "step 1 of 1" indicator). React has no visual progress affordance.
- **Effort: 1-2 hours** — gradient via a wrapper div, brand-row above the card, the step pill is optional polish.

### D-05 Payment Flow → `pages/SponsorCheckoutPage.tsx`
- Mockup shows the orphan summary as a **`tranquil-200`-bg accent panel** above the form; React's orphan card uses `bg-snow` with a `border-sky` outline.
- Mockup's amount input has a currency suffix inside the input (`KWD` rendered as a chip on the leading edge); React uses two side-by-side inputs (`amount` + `currency`).
- "Security note" exists on both, identical copy.
- **Effort: 1-2 hours** — replace the orphan card style, replace the two inputs with one chipped input.

### F-02 Incoming Payments → `pages/PaymentsPage.tsx`
- Layout matches: status filter dropdown + table (code/amount/method/status/completed_at) + CSV export.
- Mockup specifies **finance-role topbar accent** (`fin-700` ≈ `#047857` — a green tint instead of trust blue). React uses the org-admin trust palette everywhere.
- Status badge colors are slightly off: mockup uses `success-100 bg / success-700 text` for `completed`; React uses `bg-emerald-100 text-emerald-800` (close but emerald isn't part of the design system).
- **Effort: 1-2 hours** — once the design-system color ramps land in Tailwind, swap the badge classes and add a role-themed wrapper class to the finance topbar.

### OA-04 Marketing Channels → `pages/MarketingChannelsPage.tsx`
- Mockup shows columns: code, name, type, channel-manager, acquired-count, status, edit-action.
- React shows: code, name, type, status, (no manager column, no acquired count). The form for creating a channel is a single inline form vs. the mockup's two-column card.
- **Effort: half day** — add the missing columns (requires API extension if those fields aren't on the list endpoint), restructure the create form into a 2-col grid.

### OA-07 Audit Log → `pages/AuditPage.tsx` *(listed in §1 but with one cosmetic note)*
- Action-type pill colors don't differentiate `*.created` (success), `*.deleted` (danger), `*.status_changed` (warning) in React; the mockup uses three distinct background tints.
- **Effort: 1 hour** — switch on `action.split('.').pop()` and map to badge variants.

### PS-03 Register New Orphan → form inside `pages/OrphansPage.tsx`
- Mockup is a **full-page form** (sidebar removed, single-column 600px-max card with grouped sections "Identity", "Family", "Health").
- React's "new orphan" form is an **inline expansion under the page header** (toggle button reveals a form below the table).
- Functional parity, but the mockup treats new-orphan as a focused task, not an inline workflow.
- **Effort: half day** — extract `NewOrphanPage.tsx` at `/admin/orphans/new` and have the table's "Add orphan" button route there; group the fields into sections per the mockup.

### PS-04 Orphan Detail (Staff) → `pages/OrphanDetailPage.tsx`
- Mockup shows: hero with name+code+status badge, "personal info" card, "family" card, "documents" card with two-step upload, "media" thumbnails grid, "timeline" card.
- React has: hero, "personal info" `dl`, `OrphanPhotoUpload` component, `DocumentUploadCard`, "timeline" card. **Missing: a dedicated "family" card** linking to the family record (when `family_id` is set).
- The timeline kind-icon coloring is correct on both (sponsorship/payment/report/media border accents).
- **Effort: 1-2 hours** — pull family-card data via `/families/{id}` if the orphan has one, render between personal-info and documents.

**Count: 7 minor-drift pairs.**

---

## 3. Major gaps

React implementation is significantly different from the mockup or missing critical sections.

### OA-06 Organization Settings → `pages/SettingsPage.tsx`
- Mockup defines **multi-section org-admin settings**: organization profile (name, logo, default currency, country), bilingual branding (`name_ar`, `name_en`, tagline, color overrides), default `business_rules` toggles (e.g. `show_financial_to_guardian`, `auto_publish_reports`), MyFatoorah / SMTP / S3 integration setup with masked secrets, feature flags, and danger zone (transfer ownership / delete org).
- React `SettingsPage.tsx` is **personal-account settings**: change-password form, 2FA enrollment, notification preferences. It's the right place but the content is donor-style "my settings", not org-admin.
- The `OrganizationSettingsCard` component exists (`src/components/OrganizationSettingsCard.tsx`) but isn't routed in.
- **Effort: 1-2 days** — wire `OrganizationSettingsCard` into a tabbed `SettingsPage` with sections for the categories above; the org-update API already exists at `PATCH /organization`, the integration settings need new backend endpoints. The "danger zone" needs backend support too.

### Admin Sidebar Layout (system-wide, affects every `/admin/*` page)
- Every admin mockup (F-*, MM-*, OA-*, PM-*, PS-*) shows a **persistent left sidebar** with role-specific nav items + a topbar with breadcrumb + user menu.
- React's `AppLayout` does have a sidebar, but it's **role-agnostic** — every admin user sees the same nav. The mockups show finance-only / marketing-only / partner-staff-only nav variants with role-specific accent colors (finance green, marketing purple, partner orange).
- **Effort: 1 day** — extend `AppLayout` to filter nav items by `useRole()` and add a role-themed accent strip; the design-system color tokens need to exist first (§0).

### Document upload UX (admin orphan & guardian flows)
- Mockup G-04 (Monthly Report Upload) and PS-04 / D-03 documents section all show a **drag-and-drop dropzone** with progress bar + thumbnail preview + retry-on-error.
- React's `DocumentUploadCard` uses a plain `<input type="file">` + button. Functional but visually inferior.
- **Effort: half day** — swap to `react-dropzone` (no new heavy dep), add progress reporting on `axios.onUploadProgress`.

**Count: 3 major gaps.**

---

## 4. React pages without a mockup

These pages exist in code but the design team hasn't drawn them. Worth a triage pass — some are intentional micro-pages, others may be over-engineered.

| React file | Reason it has no mockup |
|---|---|
| `LandingPage.tsx` | The W-* series (public marketing site) is listed as not-yet-designed in `docs/design/screens/README.md` line 152. Current implementation is a placeholder hero + stat counters. Intentional gap. |
| `VerifyEmailPendingPage.tsx` | A-02 ends at the signup form; the "check your inbox" intermediate state isn't drawn separately. Minimal page, probably fine. |
| `VerifyEmailConfirmPage.tsx` | Same — the landing-from-the-email state isn't a drawn mockup. Minimal page, probably fine. |
| `PaymentSuccessPage.tsx` | D-05 ends at the MyFatoorah handoff; the return-confirmation page isn't drawn. Minimal page, probably fine. |
| `PaymentFailurePage.tsx` | Same. |
| `PaymentReceiptPage.tsx` | D-08 (Receipts) is the receipts *list* for the donor; the single printable receipt isn't drawn. The page has print CSS scoped via `body:has(.receipt-page)`, which suggests it's intentionally built for print rather than a designed screen. |
| `MyPortalPage.tsx` | No corresponding mockup. Appears to be a legacy / catch-all profile page. **Candidate for deletion** — the donor flow uses `DonorProfilePage`; the admin flow uses `SettingsPage`. |
| `DonorsPage.tsx` | The admin "all donors" table isn't drawn. F-03 is "Overdue Donors" (a filtered subset), MM-04 is "Acquired Donors" (channel-scoped). No designed "manage all donors" admin view exists. |
| `SponsorshipsPage.tsx` | The admin "all sponsorships" view isn't designed. D-06 is donor-scoped only. |
| `BankTransfersPage.tsx` | F-04 (Create) and F-05 (Pending Transfers) overlap, but the current React page mixes both flows. See §5 for the missing split. |
| `FamiliesPage.tsx` / `FamilyDetailPage.tsx` | Family records aren't in the design set at all. Functional but undesigned. |
| `WalkInCheckoutPage.tsx` | The admin-on-behalf walk-in flow has no mockup (PR #7 feature added without a corresponding design). |
| `ReportDetailPage.tsx` | Mockup PS-05 has the reports table but not a single-report detail view. The current detail page is functional but undesigned. |
| `PartnerDetailPage.tsx` | OA-03 has the partners table; the single-partner detail page isn't designed. |

**Count: 14 React pages without a mockup.** Of these, **MyPortalPage** is the clearest deletion candidate (functionality overlaps `DonorProfilePage` + `SettingsPage`).

---

## 5. Mockups without a React page

Designed screens that haven't been built. Sorted by user surface and likely priority.

### Auth (2 mockups)
- **A-04** 2FA Verification — separate `/2fa` page. The login flow currently doesn't show a 2FA step; the existing `pages/SettingsPage.tsx` has 2FA *enrollment* but no *verification* page.
- **A-05** Tenant Switcher — picks an organization to act as. Multi-tenant feature; not currently a backend capability either.

### Donor portal (4 mockups)
- **D-04** Sponsorship Wizard — multi-step wizard between picking an orphan and the payment flow. React currently skips this and goes directly D-03 → D-05.
- **D-07** Sponsored Orphan Detail — the post-sponsor detail view (with the donor's progress and report history). Currently `DonorSponsorshipsPage.tsx` links to `/admin/orphans/:id` which is the staff-view, leaking admin chrome into the donor area.
- **D-08** Receipts — the donor's list-of-receipts page. Currently donors view per-payment receipts via the same `PaymentReceiptPage` route as admins; no list view.
- **D-09** Donor Messages — donor inbox. No message system in the backend yet either.

### Guardian portal (5 mockups, 0 built)
- **G-01 + G-02** (combined in one HTML file) — Guardian login + dashboard. No `/guardian/*` routes exist.
- **G-03** Guardian Orphan Detail — read-only view, no financial fields per `business_rules.show_financial_to_guardian: false`.
- **G-04** Monthly Report Upload — the dropzone flow noted in §3.
- **G-05** Guardian Messages — guardian inbox.

### Finance role (4 mockups)
- **F-01** Finance Dashboard — role-specific dashboard with payment timeseries + transfer queue summary. React shares the org-admin dashboard.
- **F-03** Overdue Donors — filtered list of donors with overdue sponsorships. Backend has the underlying data; no list page.
- **F-06** Bank Statement Import — CSV upload + bank-line-matching UI.
- **F-07** Financial Reports — exports + KPI dashboards.

### Marketing manager (6 mockups, 0 built)
- **MM-01 → MM-06**: Channel Dashboard, Annual Goals, Assigned Orphans, Acquired Donors, Campaigns, Channel Reports. Backend has `marketing_channels` but no list-side or per-channel detail UI.

### Org admin (2 mockups)
- **OA-05** Business Rules — toggle UI for org-wide rules (e.g. `show_financial_to_guardian`, `auto_publish_reports`). Part of the OA-06 gap noted in §3.
- **OA-08** Reports Center — admin-wide reports list + export UI.

### Partner manager (4 mockups, 0 built)
- **PM-01 → PM-04**: Approval Center, Staff Management, Incoming Transfers, Partner Performance.

### Partner staff (2 mockups)
- **PS-01** Partner Staff Dashboard — role dashboard. Currently partner staff land on the org dashboard.
- **PS-06** Media Review — moderation queue for orphan photos. Backend has `moderation_status` field on `media`; no UI to act on it.

**Count: 29 mockups without a React page.** That's ~57% of the design set still to build.

---

## 6. Summary recommendation

Top five highest-leverage alignment tasks, ranked by visibility-to-effort ratio.

1. **System-level font + color tokens** *(half day, affects all pages).* Swap `Noto Sans Arabic` → `IBM Plex Sans Arabic` and `Inter` → `IBM Plex Sans` in `index.html`. Extend `tailwind.config.js` with the full color ramps from `rufaqaa-design-system-v0.1.html`. Update `.btn-primary`, `.card`, `.input` in `src/styles/index.css` to use `trust-300/400/500` instead of `trust/90` aliases. **Every page will look closer to the design after this single change.**

2. **OA-06 Organization Settings**, replace `SettingsPage.tsx` with a tabbed org-settings page *(1-2 days).* The biggest "looks wrong" page in the admin area: the current page is a donor-style account-settings form, but the route is `/admin/settings` which an org admin would expect to be org-scoped. The `OrganizationSettingsCard` component already exists; route it in and add the business-rules + integrations + danger-zone tabs.

3. **Role-aware admin sidebar** *(1 day).* Make `AppLayout` filter its nav by `useRole()` and apply a role-themed accent strip (finance green, marketing purple, partner orange, org-admin trust). This unblocks the visual identity for every F-*, MM-*, PM-*, PS-* page even before they're built.

4. **D-04 Sponsorship Wizard + D-07 Sponsored Orphan Detail** *(2 days each).* The donor flow currently jumps D-03 → D-05 directly and leaks staff chrome at D-07. The wizard adds expectation-setting between "I want to sponsor" and "I'm paying"; D-07 stops sending donors into the admin orphan-detail view.

5. **D-08 Receipts + receipt PDF download** *(half day).* The donor has no "all my receipts" view today — only per-payment receipts via the admin route. A dedicated `/donor/receipts` page with the list + per-row download CTA closes a real gap that donors will notice the first time they file taxes.

---

## Appendix: full coverage table

| Category | Mockups | React pages | Match | Minor drift | Major gap | Not built |
|---|---|---|---|---|---|---|
| Auth | 5 | 3 | 1 (A-03) | 2 (A-01, A-02) | — | 2 (A-04, A-05) |
| Donor | 10 | 5 | 4 (D-01, D-02, D-03, D-06) | 1 (D-05) | — | 5 (D-04, D-07, D-08, D-09, D-10 partial) |
| Guardian | 5 | 0 | — | — | — | 5 (G-01…G-05) |
| Finance | 7 | 2 | 1 (F-02 partial) | 1 (F-02 color) | — | 4 (F-01, F-03, F-06, F-07) |
| Marketing | 6 | 0 | — | — | — | 6 (MM-01…MM-06) |
| Org Admin | 8 | 5 | 3 (OA-01, OA-02, OA-03, OA-07) | 1 (OA-04) | 1 (OA-06) | 2 (OA-05, OA-08) |
| Partner Mgr | 4 | 0 | — | — | — | 4 (PM-01…PM-04) |
| Partner Staff | 6 | 3 | 2 (PS-02, PS-05) | 2 (PS-03, PS-04) | — | 2 (PS-01, PS-06) |
| **Total** | **51** | **19 (with mockup)** | **11** | **7** | **1** | **~30** |

React-only pages without a mockup: **14** (see §4).
