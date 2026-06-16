# Authorization coverage audit — staff/admin role gates

Companion to [`authorization.md`](./authorization.md). This document is the
record of the role-gate coverage audit and the least-privilege
`require_roles` gates added in **`fix/authz-role-gate-coverage`**.

## What this audit closed

The audit found a class of **staff/admin endpoints that authenticated as "any
logged-in user"** — they declared only `user: CurrentUser` (i.e. just
`get_current_user`) and no `require_roles` gate. Tenant isolation already held
(every one scopes by `get_in_org_or_404`, an explicit `organization_id`
filter, or `partner_scope_hides`), so a *donor* or *guardian* token could not
read **another org's** rows — but it could reach staff surfaces inside its own
org. This PR layers a least-privilege role gate **on top of** the existing
tenant scoping. No tenant-scoping logic and no existing gate was changed or
weakened; gates were only **added**.

## Role groupings

Defined in [`app/core/authz.py`](../../backend/app/core/authz.py); `super_admin`
passes every `require_roles` check.

| Grouping | Members |
|---|---|
| `ADMIN_ROLES` | `super_admin`, `org_admin` |
| `FINANCE_ROLES` | `finance` + `ADMIN_ROLES` |
| `MARKETING_ROLES` | `marketing_manager` + `ADMIN_ROLES` |
| `STAFF_ROLES` | `super_admin`, `org_admin`, `partner_manager`, `partner_staff`, `marketing_manager`, `finance` |
| `PARTNER_SCOPED_ROLES` | `partner_manager`, `partner_staff` (further narrowed by `partner_scope_hides`) |

Tenant-scoping mechanisms referenced below:

- **`get_in_org_or_404`** — org-scoped fetch-by-id; a cross-org id 404s.
- **explicit org filter** — `Model.organization_id == user.organization_id` in the query (incl. raw-SQL `media`/`audit_log`).
- **org-anchored construct** — create endpoints stamp `organization_id=user.organization_id` on the new row.
- **`partner_scope_hides`** — layered on the org filter; confines `partner_manager`/`partner_staff` to their own جهة.
- **principal org** — reads the caller's own `organization_id` (e.g. `/organization`).

---

## Gates added in this PR

| Method | Path | Handler | Role gate | Tenant scoping |
|---|---|---|---|---|
| GET | `/api/v1/donors` | `list_donors` | `FINANCE_ROLES` | explicit org filter |
| GET | `/api/v1/donors/export.csv` | `export_donors_csv` | `FINANCE_ROLES` | explicit org filter |
| POST | `/api/v1/donors` | `create_donor` | `FINANCE_ROLES` | org-anchored construct |
| GET | `/api/v1/donors/{donor_id}` | `get_donor` | `FINANCE_ROLES` | `get_in_org_or_404` |
| PATCH | `/api/v1/donors/{donor_id}` | `update_donor` | `FINANCE_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/payments` | `create_payment` | `FINANCE_ROLES` | `get_in_org_or_404` + org-anchored |
| GET | `/api/v1/payments/{payment_id}/receipt` | `payment_receipt` | `FINANCE_ROLES` | `get_in_org_or_404` |
| GET | `/api/v1/payments/export.csv` | `export_payments_csv` | `FINANCE_ROLES` | explicit org filter |
| POST | `/api/v1/sponsorships` | `create_sponsorship` | `FINANCE_ROLES` | `get_in_org_or_404` + org-anchored |
| GET | `/api/v1/sponsorships/export.csv` | `export_sponsorships_csv` | `FINANCE_ROLES` | explicit org filter |
| GET | `/api/v1/sponsorships/{sponsorship_id}` | `get_sponsorship` | `FINANCE_ROLES` | `get_in_org_or_404` |
| PATCH | `/api/v1/sponsorships/{sponsorship_id}` | `update_sponsorship` | `FINANCE_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/sponsorships/{sponsorship_id}/pause` | `pause_sponsorship` | `FINANCE_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/sponsorships/{sponsorship_id}/resume` | `resume_sponsorship` | `FINANCE_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/sponsorships/{sponsorship_id}/cancel` | `cancel_sponsorship` | `FINANCE_ROLES` | `get_in_org_or_404` |
| GET | `/api/v1/families` | `list_families` | `STAFF_ROLES` | explicit org filter |
| POST | `/api/v1/families` | `create_family` | `STAFF_ROLES` | org-anchored construct |
| GET | `/api/v1/families/{family_id}` | `get_family` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/families/{family_id}/guardians` | `list_guardians` | `STAFF_ROLES` | explicit org filter (parent family) |
| POST | `/api/v1/families/{family_id}/guardians` | `create_guardian` | `STAFF_ROLES` | explicit org filter (parent) + org-anchored |
| GET | `/api/v1/orphanages` | `list_orphanages` | `STAFF_ROLES` | explicit org filter + `partner_scope` (inline) |
| POST | `/api/v1/orphanages` | `create_orphanage` | `STAFF_ROLES` | org-anchored construct |
| GET | `/api/v1/orphanages/{orphanage_id}` | `get_orphanage` | `STAFF_ROLES` | explicit org filter + `partner_scope_hides` |
| PATCH | `/api/v1/orphanages/{orphanage_id}` | `update_orphanage` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/orphans` | `list_orphans` | `STAFF_ROLES` | explicit org filter + `partner_scope` (inline) |
| GET | `/api/v1/orphans/export.csv` | `export_orphans_csv` | `STAFF_ROLES` | explicit org filter + `partner_scope` (inline) |
| GET | `/api/v1/orphans/{orphan_id}` | `get_orphan` | `STAFF_ROLES` | `get_in_org_or_404` + `partner_scope_hides` |
| PATCH | `/api/v1/orphans/{orphan_id}` | `update_orphan` | `STAFF_ROLES` | `get_in_org_or_404` + `partner_scope_hides` |
| GET | `/api/v1/orphans/{orphan_id}/timeline` | `orphan_timeline` | `STAFF_ROLES` | `get_in_org_or_404` + `partner_scope_hides` |
| GET | `/api/v1/media/orphans/{orphan_id}/photos` | `list_orphan_photos` | `STAFF_ROLES` | `get_in_org_or_404` + explicit org filter (media) |
| GET | `/api/v1/media/{media_id}/url` | `get_media_presigned_url` | `STAFF_ROLES` | explicit org filter (media) |
| GET | `/api/v1/partners/{partner_id}` | `get_partner` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/partners/{partner_id}/stats` | `get_partner_stats` | `STAFF_ROLES` | explicit org filter (partner; children by FK) |
| GET | `/api/v1/organization` | `get_current_organization` | `STAFF_ROLES` | principal org |
| GET | `/api/v1/stats/summary` | `dashboard_summary` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/stats/payments-timeseries` | `payments_timeseries` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/stats/sponsorships-by-status` | `sponsorships_by_status` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/stats/donations-by-partner` | `donations_by_partner` | `STAFF_ROLES` | explicit org filter |
| GET | `/api/v1/marketing-channels` | `list_marketing_channels` | `MARKETING_ROLES` | explicit org filter |
| GET | `/api/v1/marketing-channels/{channel_id}` | `get_marketing_channel` | `MARKETING_ROLES` | `get_in_org_or_404` |
| GET | `/api/v1/audit` | `list_audit` | `ADMIN_ROLES` | explicit org filter |

**Body checks kept (gate added _in addition_, never instead).** The
partner-scoped surfaces keep their per-row `partner_scope_hides` 404 (orphans
`get`/`patch`/`timeline`, orphanages `get`) and the inline `partner_scope`
WHERE-clause on the list/export endpoints (orphans `list`/`export`, orphanages
`list`). Adding `STAFF_ROLES` does not change them: `partner_manager` /
`partner_staff` are members of `STAFF_ROLES`, so they still pass the gate and
are then narrowed to their own جهة exactly as before.

---

## Pre-existing gates (already correct — unchanged)

Recorded here so the table covers **every** staff/admin endpoint.

| Method | Path | Handler | Role gate | Tenant scoping |
|---|---|---|---|---|
| GET | `/api/v1/payments` | `list_payments` | `FINANCE_ROLES` | explicit org filter |
| POST | `/api/v1/payments/admin/initiate-on-behalf` | `admin_initiate_on_behalf` | `ADMIN_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/payments/{payment_id}/refund` | `refund_payment` | `ADMIN_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/payments/{payment_id}/status` | `update_payment_status` | `ADMIN_ROLES` | `get_in_org_or_404` |
| GET | `/api/v1/sponsorships` | `list_sponsorships` | `FINANCE_ROLES` | explicit org filter |
| POST | `/api/v1/donors/{donor_id}/restore` | `restore_donor` | `ADMIN_ROLES` | `get_in_org_or_404` |
| DELETE | `/api/v1/donors/{donor_id}` | `soft_delete_donor` | `ADMIN_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/orphans` | `create_orphan` | `partner_manager`/`partner_staff` + `ADMIN_ROLES` | org-anchored + server-side partner scope |
| DELETE | `/api/v1/orphans/{orphan_id}` | `delete_orphan` | `ADMIN_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/orphans/{orphan_id}/assign-channel` | `assign_orphan_channel` | `ADMIN_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/orphans/{orphan_id}/approve` | `approve_orphan` | `partner_manager` + `ADMIN_ROLES` | `get_in_org_or_404` + `partner_scope_hides` |
| POST | `/api/v1/orphans/{orphan_id}/reject` | `reject_orphan` | `partner_manager` + `ADMIN_ROLES` | `get_in_org_or_404` + `partner_scope_hides` |
| POST | `/api/v1/orphans/{orphan_id}/release` | `release_orphan` | `partner_manager` + `ADMIN_ROLES` | `get_in_org_or_404` + `partner_scope_hides` |
| POST | `/api/v1/media/orphans/{orphan_id}/photo` | `upload_orphan_photo` | `STAFF_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/media/file` | `upload_generic_file` | `STAFF_ROLES` | n/a (no tenant row; key namespaced by org) |
| GET | `/api/v1/media` | `list_media_queue` | `partner_manager` + `ADMIN_ROLES` | explicit org filter (media) |
| POST | `/api/v1/media/{media_id}/moderate` | `moderate_media` | `partner_manager` + `ADMIN_ROLES` | explicit org filter (media) |
| GET | `/api/v1/partners` | `list_partners` | `FINANCE_ROLES` + `PARTNER_SCOPED_ROLES` | explicit org filter + `partner_scope` (inline) |
| POST | `/api/v1/partners` | `create_partner` | `ADMIN_ROLES` | org-anchored construct |
| PATCH | `/api/v1/partners/{partner_id}` | `update_partner` | `ADMIN_ROLES` | explicit org filter |
| DELETE | `/api/v1/partners/{partner_id}` | `archive_partner` | `ADMIN_ROLES` | explicit org filter |
| PATCH | `/api/v1/organization` | `update_current_organization` | `ADMIN_ROLES` | principal org |
| POST | `/api/v1/marketing-channels` | `create_marketing_channel` | `ADMIN_ROLES` | org-anchored construct |
| GET | `/api/v1/marketing-channels/{channel_id}/progress` | `channel_progress` | `MARKETING_ROLES` | explicit org filter |
| PATCH | `/api/v1/marketing-channels/{channel_id}` | `update_marketing_channel` | `ADMIN_ROLES` | `get_in_org_or_404` |
| DELETE | `/api/v1/marketing-channels/{channel_id}` | `archive_marketing_channel` | `ADMIN_ROLES` | `get_in_org_or_404` |
| GET | `/api/v1/stats/platform/*` (6) | `platform_*` | `super_admin` (`SuperAdmin` alias) | intentionally cross-org |
| GET/POST | `/api/v1/orphans/{id}/documents`, `/api/v1/guardians/{id}/documents`, `POST /api/v1/documents`, `GET /api/v1/documents/{id}/url` | documents read/attach | `STAFF_ROLES` | `get_in_org_or_404` |
| POST | `/api/v1/documents/{document_id}/verify` | `verify_document` | `ADMIN_ROLES` | `get_in_org_or_404` |
| DELETE | `/api/v1/documents/{document_id}` | `delete_document` | `ADMIN_ROLES` | `get_in_org_or_404` |
| GET/POST | `/api/v1/bank-transfers` (+ approve/mark-completed/cancel/confirm-receipt) | bank transfer ops | `ADMIN_ROLES` | explicit org filter / `get_in_org_or_404` |
| GET/POST/PATCH | `/api/v1/users` (+ invite/suspend/reactivate/{id}) | user admin | `ADMIN_ROLES` | explicit org filter / `get_in_org_or_404` |

---

## Needs decision

### `messages` — `GET /api/v1/messages` (`list_messages`) and `POST /api/v1/messages/{message_id}/read` (`mark_message_read`)

**Left unchanged. Do not apply a `STAFF_ROLES` gate without a product
decision.** The audit proposal listed these under `STAFF_ROLES`, but applying
that gate would lock out the principals the endpoints exist to serve:

- These are the **donor ⇄ guardian** conversation surfaces. `list_messages`
  returns the caller's own thread (sender = any status, recipient = approved)
  and only widens to the whole org for moderators; `mark_message_read` is the
  **recipient**-only read receipt. `SENDER_ROLES` is `("donor", "guardian")`.
- `STAFF_ROLES` contains neither `donor` nor `guardian`, so the gate would
  return 403 to every donor and guardian — i.e. it would **break the feature**,
  not harden it.
- Verified against the live surfaces: the frontend `DonorMessagesPage` /
  `GuardianMessagesPage` call `GET /messages` and `POST /messages/{id}/read`
  via `lib/messages.ts`, and the integration tests
  (`test_messages.py::test_guardian_only_sees_own_conversations_via_list`,
  `test_donor_cannot_read_other_donors_message`) assert `200` for donor/guardian
  callers. The no-DB harness in `test_authz_role_matrix.py` also shows a donor
  reaches the handler (not a 403) on both routes today.

These endpoints already enforce per-row authorization in the body
(`_viewer_can_see` / recipient-ownership) on top of `get_in_org_or_404`, so a
non-participant cannot read or mark another conversation. **Recommendation:**
keep the per-row body checks as the authorization mechanism and do **not** add
a role gate; if a role restriction is ever wanted, the role set must include
`donor` and `guardian`, which makes a dependency-level `require_roles` the wrong
tool here.

---

## Reviewed and intentionally not gated (out of this PR's scope)

- **`reports.py`** (`list`/`create`/`get`/`update`/`submit` reports): a
  **guardian-reachable** surface. `_check_report_access` scopes guardians to
  reports for orphans in their own family and lets staff pass through, on top of
  `get_in_org_or_404`. Like `messages`, a `STAFF_ROLES` gate would lock out
  guardians. The reviewer/workflow transitions
  (`approve-partner`/`approve-org`/`publish`/`reject`) are already gated to
  `REPORT_REVIEWER_ROLES`. Not in the audit's gate list — left unchanged.
- **`POST /api/v1/payments/initiate`** (`initiate_payment`): donor-reachable by
  design (a donor pays for themselves; staff may initiate on behalf). Guarded by
  an in-body split (`user.role == "donor"` → must own the donor row + verified
  email) plus `get_in_org_or_404`. Not in scope.
- **`*_self` routers, `donor_portal`, `public`, `auth`, `twofa`,
  `webhooks/myfatoorah`, `users/accept-invite`** and everything already gated by
  `require_roles` / the `SuperAdmin` alias (all of `platform.py`, `/stats/platform/*`):
  explicitly out of scope per the task; not modified.

---

## Tests

`backend/tests/test_authz_role_matrix.py` is a parametrised, **database-free**
matrix over a representative sample of the newly-gated endpoints:

- a `donor` and a `guardian` principal receive **403** on every sampled endpoint;
- an `org_admin` principal (in `ADMIN_ROLES ⊆ FINANCE/MARKETING/STAFF`) **clears
  every gate** (not 403);
- least-privilege spot checks: a staff role *outside* an endpoint's grouping is
  still 403 (e.g. `marketing_manager` → `/donors`, `finance` → `/audit`,
  `partner_staff` → `/audit`), while a role *inside* it clears the gate.

It overrides `get_current_user` to mint the principal under test and stubs
`get_db` so any request that clears the gate fails inside the handler — proving
the **gate**, not the handler, is what produces the 403.
