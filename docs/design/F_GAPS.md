# Finance (F-01 … F-07) — Residual Design Gaps

Written **before** any code, from a line-by-line read of each page, its CSS
(`frontend/src/pages/finance.css`), the mockups in
`docs/design/screens/finance/`, and the available API surface
(`lib/payments.ts`, `lib/bankTransfers.ts`, `lib/stats.ts`).

**Context.** Batch 5 already landed on `main`
(`17a63a8 feat(frontend): pixel-match Finance (F-01..F-07)`): all six pages have
structure + a shared `finance.css`. This pass **closes the residual gaps** below
and adds a **dedicated per-page CSS file** for the new structure (scoped under
`.fin-page`, inheriting its token block — Design-System tokens only, RTL-logical,
`tabular-nums`). Nothing already merged is reverted.

**Legend** — `FE` = frontend-doable now · `BE` = backend data/endpoint missing →
render the design layout with placeholder (`—`) + `// TODO(backend)`, never invent
APIs or fake live numbers (per brief, esp. F-01).

---

## F-01 Finance Dashboard ↔ `FinanceDashboardPage.tsx`
Mockup sections: Treasury hero · dual In/Out cash-flow (zero line) · KPI strip ·
Quick actions · Incoming + Pending transfers · Orphan balances by partner · FX strip.

| # | Mockup element | State now | Gap | Class |
|---|----------------|-----------|-----|-------|
| 1 | **FX exchange strip** (USD/SAR/EGP/AED → KWD, delta arrows, "updated" time) | Only a one-line `fin-notice` | Replace notice with the **full FX-pair strip layout**; rates render as `—` placeholders + refresh-time placeholder. | **BE** |
| 2 | **Cash-flow chart** — dual bars: inflow above / outflow (transfers) below a zero line, two-colour legend | Single inflow **area** line only | Rebuild as **dual in/out bar chart with zero line + In/Out legend**. Inflow = real timeseries; **outflow bars = placeholder/0** + TODO. | **BE** (outflow) |
| 3 | **Orphan balances by partner** — header **Balance / Count toggle**, alt bar colour | Balance bars only, single colour | Add **Balance↔Count toggle** using `payments_total` / `payments_count` (both real; label "Transactions" accurately — orphan-count is not in the API). Alt fill for the toggled view. | **FE** |
| 4 | **Pending transfers list** — per-row **due-date status chip** ("due in N days" / "overdue") | Status chip only | Add a due-status chip slot rendering `—` + TODO (no `due_date` on `BankTransfer`). | **BE** |
| 5 | Treasury hero + KPI strip + Quick actions + Incoming list | Present, matches | — | — |

CSS: **`FinanceDashboardPage.css`** (`fin-fx-*`, dual-chart `fin-cf2-*`, toggle `fin-obal-*`, `fin-due-chip`).

---

## F-02 Incoming Payments ↔ `PaymentsPage.tsx`
Mockup sections: Stats · Tabs · Filter · Bulk · Table.

| # | Mockup element | State now | Gap | Class |
|---|----------------|-----------|-----|-------|
| 1 | **Filter bar** — date-range segmented control (Today/Month/90d/Year/Custom) + method + currency pills | Search box only | Add **date-range segmented control + method + currency pills**, applied **client-side over the loaded page** (consistent with the existing client-side search; list API exposes no such params). | **FE** |
| 2 | **Bulk bar** — row checkboxes + selection bar (reconcile / export selected / send receipts) | None | Add **checkbox column + selection bar** (count + summed amount). Reconcile/send → `comingSoon` toast; export selected reuses CSV export. | **FE** |
| 3 | **Numbered pagination** + page-size selector | Prev/Next only | Add **numbered pages + page-size selector**. | **FE** |
| 4 | Table cols **Donor**, **Orphan**, **Type/Category** (Zakat/Kafala) | Not in list response | Render columns with `—`/code + TODO (list API has no donor/orphan **name** or category; only receipt endpoint does — N calls disallowed). | **BE** |
| 5 | **Zakat** tab + Zakat stat | Tabs have an extra `pending`; no Zakat | Drop stray `pending` tab to match; Zakat tab/stat → omit (no zakat status/category) — note as BE. | partial **BE** |
| 6 | Stats · status tabs · status chips · empty/loading/error | Present | — | — |

CSS: **`PaymentsPage.css`** (`fin-rangebar`, `fin-fpill`, `fin-bulkbar`, `fin-checkcell`, `fin-pager`).

---

## F-03 Overdue Donors ↔ `OverdueDonorsPage.tsx`
Mockup sections: Tone reminder · Severity bands · Filter · Bulk · Table · Reminder modal.

| # | Mockup element | State now | Gap | Class |
|---|----------------|-----------|-----|-------|
| 1 | **Filter pills** — country + sort-order, next to search | Search only | Add **country + sort** pills, applied client-side (country from donor data if present, else sort by days/amount). | **FE** |
| 2 | **Bulk bar** — row checkboxes + WhatsApp/Email/Hide actions | None | Add **checkbox column + selection bar**; actions → `comingSoon`. | **FE** |
| 3 | **Context-aware row actions** per band (b1 friendly → b4 suspend/call) + 3-dot menu | Single "Send reminder" for all | Render **band-specific action set** (labels via i18n); handlers → `comingSoon` (no reminder/suspend endpoint). | **FE** layout / **BE** wiring |
| 4 | **Severity-band advice text** under each band count | Band has label+range+count+amount | Add the short **advice line** per band. | **FE** |
| 5 | **Reminder template modal** (channel + template preview + schedule) | None | Out of scope for a layout pass — **no endpoint**; leave the existing `reminderNotTracked` note + TODO. | **BE** (skip) |
| 6 | **Reminder trail** timeline column | `—` + TODO already | Keep placeholder; render the dotted-trail **layout** with placeholder states. | **BE** |
| 7 | Tone banner · bands · table · empty/loading/error | Present | — | — |

CSS: **`OverdueDonorsPage.css`** (`fin-od-pill`, `fin-od-bulk`, `fin-od-actions`, `fin-trail`).

---

## F-04 + F-05 Bank Transfers ↔ `BankTransfersPage.tsx`  *(single route, both screens)*
F-04: Stepper · Step cards · **Right summary rail** · Footer nav.
F-05: Workflow header · Stages · Filter · Transfer list · Approval modal.

| # | Mockup element | State now | Gap | Class |
|---|----------------|-----------|-----|-------|
| 1 | **F-04/F-05 split clarity** | F-04 is a collapsible inline form inside the F-05 list | Make the split **explicit via two tabs** ("Pending pipeline" / "Create transfer") on the one route — no routing change, no logic change. | **FE** |
| 2 | **F-04 create — summary rail** (running total, currency, approval notice) | Flat form, no summary | Add a **right-hand summary rail** beside the form, computed from the form's own fields (partner/amount/currency/period). | **FE** |
| 3 | **F-04 — period quick-buttons** (Prev month / This month / Quarter) | Two date inputs only | Add quick-set buttons that fill the date inputs. | **FE** |
| 4 | **F-04 — itemized per-orphan table** + **FX banner** | Note only | No line-item or FX in create API → keep the existing itemized **note** + TODO; render an FX-banner **slot** with `—`. | **BE** |
| 5 | **F-05 — sort/filter pill** beside search | Search only | Add a **sort pill** (oldest/newest/amount), client-side. | **FE** |
| 6 | **F-05 — secondary row actions** (View details / PDF) | Primary actions only | Add **secondary action** slot; handlers → `comingSoon`. Primary action labels unchanged (E2E-sensitive). | **FE** layout |
| 7 | **F-05 — card meta** (orphan count, payment count, bank fees, FX) | Reference/bank/period/created shown | Keep present meta; missing fields are not on `BankTransfer` → omit, no fake values. | **BE** |
| 8 | Pipeline header · stage tiles · workflow trail · status chips · primary actions · empty/loading/error | Present, strong match | — | — |

CSS: **`BankTransfersPage.css`** (`fin-bt-tabs`, `fin-bt-rail`, `fin-bt-quick`, `fin-bt-fxslot`, `fin-bt-sort`).

---

## F-06 Bank Statement Import ↔ `BankStatementImportPage.tsx`  *(static shell — no endpoint)*
Mockup: Stepper · Step 1 file · **Step 2 bank** · Step 3 mapping · **Step 4 recon** (summary tiles · **match bar** · **filter tabs** · **recon table**) · **Footer nav**.

| # | Mockup element | State now | Gap | Class |
|---|----------------|-----------|-----|-------|
| 1 | **Step 2 — bank picker grid** | Missing entirely | Render the **bank-picker grid** (KFH/NBK/Gulf/Ahli/Boubyan/Custom) as a disabled static shell. | **BE** layout |
| 2 | **Step 4 — match bar + legend** | Summary tiles only | Add the **stacked match bar + inline legend** (placeholder proportions). | **BE** layout |
| 3 | **Step 4 — filter tabs** (All/Matched/Needs review/Duplicates) | Missing | Render the **filter-tab strip** (inert). | **BE** layout |
| 4 | **Step 4 — reconciliation table** (Date/Statement/Amount/Suggested/Status/Actions) | Missing | Render the **recon table header + a placeholder empty state** (no invented rows). | **BE** layout |
| 5 | **Step 1 — uploaded-file info card** | Drop zone only | Add the **file-info card** layout (name/size/rows = `—`). | **BE** layout |
| 6 | **Footer nav** (Previous / Import N payments) | Missing | Add the **footer action bar** (disabled). | **BE** layout |
| 7 | Header · notice · stepper · drop zone · mapping table | Present | Mapping table is missing the **arrow column** + 2 rows — add to match. | **FE** |

CSS: **`BankStatementImportPage.css`** (`fin-bankgrid`, `fin-matchbar`, `fin-rtabs`, `fin-recon-table`, `fin-fileinfo`, `fin-import-foot`).

---

## F-07 Financial Reports ↔ `FinancialReportsPage.tsx`
Mockup: Year hero · Tabs · Statutory + standard report cards (+ **Custom builder**) · **Recent runs** table · **Annual-close banner**.

| # | Mockup element | State now | Gap | Class |
|---|----------------|-----------|-----|-------|
| 1 | **Custom-builder card** (dashed, drag icon, "N saved" + Start) in the grid | Missing | Add the **custom-builder card** as the grid's last tile; Start → `comingSoon`. | **FE** |
| 2 | **Recent runs** table (Report/Period/Signer/Size/Time/Actions) | Missing | Render the **recent-runs table header + empty state** + TODO (no report-history endpoint). | **BE** layout |
| 3 | **Annual-close banner** (schedule note + action) | Missing | Add the **info banner** layout; action → `comingSoon`. | **FE** |
| 4 | **Tab nav** (Ready/Saved/Audited/Generator) | Header buttons instead | Keep header buttons (functionally equivalent) — note divergence; do **not** add inert tabs. | accept |
| 5 | Year hero + live stats · statutory grid · by-partner table · empty/loading | Present | Fix `statZakat` label (currently shows donors count) to read accurately. | **FE** |

CSS: **`FinancialReportsPage.css`** (`fin-rep-custom`, `fin-runs-table`, `fin-close-banner`).

---

## Cross-cutting (all pages)
- **i18n**: every new string added to **both** `ar.json` and `en.json`, key parity, reuse existing `finance.*` / `payments.*` / `bankTransfers.*` / `financeImport.*` namespaces, no duplicates.
- **RTL** + responsive **1280/1024/768/375**; **`tabular-nums`** on all figures; currency via existing `Money` (KWD 3-dp).
- **a11y**: `<table>`/`<th scope>` semantics, `aria-pressed`/`aria-label` on icon controls, focus rings, contrast ≥ 4.5:1.
- **Untouched**: finance logic, API calls, routing, `FinanceRoute`/role guards, and all non-F files. Primary `bankTransfers.*` action labels preserved for the E2E.

## Delivery
One commit per page (F-01 → F-07). Then `npm run lint && typecheck && build` + tests.
Branch `claude/batch5-finance-fix`; one PR; **no merge** — review page-by-page.
