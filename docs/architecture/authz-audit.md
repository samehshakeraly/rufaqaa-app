# Authorization coverage audit — staff/admin endpoint role gates (B2)

This document records the authorization-coverage audit of the v1 API and the
least-privilege `require_roles` gates added as a result. It complements
[`authorization.md`](./authorization.md), which describes the model; this file
is the per-endpoint ledger.

## The finding

`get_current_user` (in `app/api/deps.py`) authenticates a request and checks
`status == 'active'` — it does **not** check `role`. Role-based least privilege
is layered on top by the `require_roles` dependency (`app/core/authz.py`).

The audit found **42 staff/admin endpoints across 14 routers** that declared a
bare `CurrentUser` with no `require_roles` gate, so they accepted **any**
authenticated principal — including the pure data-consumer roles (`donor`,
`guardian`, and the reserved `orphan` / `viewer`).

Tenant isolation was **not** the issue: every one of these endpoints already
scoped to the caller's organization (via `get_in_org_or_404`, an explicit
`organization_id == user.organization_id` filter, or an org-anchored insert),
and the static guard in `tests/test_tenant_scope_guard.py` enforces that. The
exposure was therefore **within-tenant privilege escalation** — e.g. a donor in
org A reading org A's donor list, finance exports, or audit log — not
cross-tenant leakage.

This pass closes it with the narrowest gate that still admits every role that
legitimately uses each surface.

## Role groupings

From `app/core/authz.py` (`super_admin` clears every gate):

| Group | Members |
|---|---|
| `ADMIN_ROLES` | `super_admin`, `org_admin` |
| `FINANCE_ROLES` | `finance` + `ADMIN_ROLES` |
| `MARKETING_ROLES` | `marketing_manager` + `ADMIN_ROLES` |
| `STAFF_ROLES` | `super_admin`, `org_admin`, `partner_manager`, `partner_staff`, `marketing_manager`, `finance` |

`PARTNER_SCOPED_ROLES` (`partner_manager`, `partner_staff`) are a subset of
`STAFF_ROLES` whose visibility is further narrowed to their own جهة
(`partner_organization_id`) by `partner_scope_hides` / inline `WHERE` clauses.
Those narrowing filters are **unchanged** by this pass — the role gate is the
outer fence, partner-scoping the inner one.

## Gated in this pass (42 endpoints)

Tenant-scoping legend:
- **id→404** — `get_in_org_or_404(...)` (a cross-org id 404s, existence hidden)
- **WHERE org** — explicit `Model.organization_id == user.organization_id`
- **org-anchored** — row constructed with `organization_id=user.organization_id`
- **parent-scoped** — child rows reached via an org-checked parent fetch
- **+partner-scope** — `partner_scope_hides` / inline جهة narrowing also applies
- **principal org** — reads the caller's own `organization_id` row

### FINANCE_ROLES — donor records & money movement (15)

| Method | Path | Router · handler | Tenant scoping |
|---|---|---|---|
| GET | `/donors` | donors · list_donors | WHERE org |
| GET | `/donors/export.csv` | donors · export_donors_csv | WHERE org |
| POST | `/donors` | donors · create_donor | org-anchored |
| GET | `/donors/{donor_id}` | donors · get_donor | id→404 |
| PATCH | `/donors/{donor_id}` | donors · update_donor | id→404 |
| POST | `/payments` | payments · create_payment | id→404 (donor/sponsorship) |
| GET | `/payments/{payment_id}/receipt` | payments · payment_receipt | id→404 |
| GET | `/payments/export.csv` | payments · export_payments_csv | WHERE org |
| POST | `/sponsorships` | sponsorships · create_sponsorship | id→404 + org-anchored |
| GET | `/sponsorships/export.csv` | sponsorships · export_sponsorships_csv | WHERE org |
| GET | `/sponsorships/{sponsorship_id}` | sponsorships · get_sponsorship | id→404 |
| PATCH | `/sponsorships/{sponsorship_id}` | sponsorships · update_sponsorship | id→404 |
| POST | `/sponsorships/{sponsorship_id}/pause` | sponsorships · pause_sponsorship | id→404 |
| POST | `/sponsorships/{sponsorship_id}/resume` | sponsorships · resume_sponsorship | id→404 |
| POST | `/sponsorships/{sponsorship_id}/cancel` | sponsorships · cancel_sponsorship | id→404 |

### STAFF_ROLES — case-management surfaces (24)

| Method | Path | Router · handler | Tenant scoping |
|---|---|---|---|
| GET | `/families` | families · list_families | WHERE org |
| POST | `/families` | families · create_family | org-anchored |
| GET | `/families/{family_id}` | families · get_family | WHERE org |
| GET | `/families/{family_id}/guardians` | families · list_guardians | parent-scoped |
| POST | `/families/{family_id}/guardians` | families · create_guardian | parent-scoped + org-anchored |
| GET | `/orphanages` | orphanages · list_orphanages | WHERE org +partner-scope |
| POST | `/orphanages` | orphanages · create_orphanage | org-anchored |
| GET | `/orphanages/{orphanage_id}` | orphanages · get_orphanage | WHERE org +partner-scope |
| PATCH | `/orphanages/{orphanage_id}` | orphanages · update_orphanage | WHERE org +partner-scope |
| GET | `/orphans` | orphans · list_orphans | WHERE org +partner-scope |
| GET | `/orphans/export.csv` | orphans · export_orphans_csv | WHERE org +partner-scope |
| GET | `/orphans/{orphan_id}` | orphans · get_orphan | id→404 +partner-scope |
| PATCH | `/orphans/{orphan_id}` | orphans · update_orphan | id→404 +partner-scope |
| GET | `/orphans/{orphan_id}/timeline` | orphans · orphan_timeline | id→404 +partner-scope |
| GET | `/media/orphans/{orphan_id}/photos` | media · list_orphan_photos | id→404 + WHERE org |
| GET | `/media/{media_id}/url` | media · get_media_presigned_url | WHERE org |
| GET | `/partners/{partner_id}` | partners · get_partner | WHERE org |
| GET | `/partners/{partner_id}/stats` | partners · get_partner_stats | WHERE org |
| GET | `/organization` | organization · get_current_organization | principal org |
| GET | `/stats/summary` | stats · dashboard_summary | WHERE org |
| GET | `/stats/payments-timeseries` | stats · payments_timeseries | WHERE org |
| GET | `/stats/sponsorships-by-status` | stats · sponsorships_by_status | WHERE org |
| GET | `/stats/donations-by-partner` | stats · donations_by_partner | WHERE org |
| GET | `/reports` | reports · list_reports | WHERE org |

Partner-scoped staff keep their جهة narrowing on the orphan/orphanage surfaces:
the `STAFF_ROLES` gate admits them, then `partner_scope_hides` (detail/timeline)
or the inline `WHERE partner_organization_id = ...` (list/export) hides rows
outside their own جهة. A scoped user with no جهة set sees nothing.

### MARKETING_ROLES — acquisition channels (2)

| Method | Path | Router · handler | Tenant scoping |
|---|---|---|---|
| GET | `/marketing-channels` | marketing_channels · list_marketing_channels | WHERE org |
| GET | `/marketing-channels/{channel_id}` | marketing_channels · get_marketing_channel | id→404 |

### ADMIN_ROLES — audit trail (1)

| Method | Path | Router · handler | Tenant scoping |
|---|---|---|---|
| GET | `/audit` | audit · list_audit | WHERE org |

## Already gated before this pass (unchanged)

These were left exactly as they were — this pass neither weakened nor widened
any existing gate. Representative examples:

- **ADMIN_ROLES** — donor restore/soft-delete, payment refund / status override /
  admin-initiate-on-behalf, partner create/update/archive, marketing-channel
  create/update/archive, orphan delete / assign-channel, bank-transfers (all),
  users (all), organization PATCH, webhook reprocess.
- **STAFF_ROLES** — media upload (photo / generic file), documents (all reads +
  attach).
- **Workflow subsets** — `PARTNER_APPROVER_ROLES` (orphan approve/reject/release),
  `REPORT_REVIEWER_ROLES` (report approve-partner/approve-org/publish/reject),
  `MEDIA_MODERATOR_ROLES` / `MESSAGE_MODERATOR_ROLES` (moderation queues + decide),
  `ORPHAN_CREATOR_ROLES` (staff orphan registration).
- **super_admin only** — every `/platform/*` console endpoint and the cross-org
  `/stats/platform/*` analytics.
- **require_verified_donor** — donor self-service state changes (`/donor/me/*`,
  donor-initiated `/payments/initiate`).

## Intentionally NOT gated (by design)

These reach tenant data on a bare `CurrentUser`, but a `require_roles` gate
would be wrong because the surface is resource/principal-scoped and is used by
non-staff roles. Each enforces access inline instead.

| Method | Path | Handler | Why no role gate |
|---|---|---|---|
| GET | `/messages` | messages · list_messages | Participant-scoped: moderators see the org queue; everyone else is narrowed to rows where they are sender (any status) or recipient (approved). A `STAFF` gate would 403 the donors/guardians the feature is for. |
| POST | `/messages/{message_id}/read` | messages · mark_message_read | Recipient-only inline check (`msg.to_user_id == user.id`). Used by donors/guardians. |
| POST | `/messages` | messages · send_message | Restricted inline to `SENDER_ROLES` (`donor`, `guardian`); recipient + orphan resolved through `get_in_org_or_404`. |
| GET | `/messages/{message_id}` | messages · get_message | Participant check (`_viewer_can_see`) — sender, approved-recipient, or moderator. |
| POST | `/reports` | reports · create_report | Guardians create reports for orphans in their own family (inline family check); staff/admin pass through. |
| GET | `/reports/{report_id}` | reports · get_report | `_check_report_access` — guardian family ownership; staff/admin pass through. |
| PATCH | `/reports/{report_id}` | reports · update_report | `_check_report_access` (draft-only). |
| POST | `/reports/{report_id}/submit` | reports · submit_report | `_check_report_access` — the owning guardian (or staff) submits. |
| POST | `/payments/initiate` | payments · initiate_payment | Dual-use: donors initiate for themselves (inline `donor.user_id == user.id` + verified-email check); staff/admins initiate on behalf. |

Only the **org-wide** report list (`GET /reports`) is staff-gated; the
single-report endpoints keep `_check_report_access` so a guardian retains
family-scoped access to their own orphans' reports.

## Needs decision

- **Messaging surface (`/messages`).** Left participant-scoped (above). The open
  question is whether donor⇄guardian messaging should additionally require an
  active sponsorship relationship between the two parties, rather than only
  "same org + participant". That is a product/policy call, not a missing gate,
  and is tracked here rather than silently hard-coded. Until decided, the
  inline participant checks stand.

## Regression guard

`backend/tests/test_authz_role_matrix.py` is a DB-free matrix that introspects
the live dependency graph to recover each endpoint's `require_roles` allow-set
and exercises the gate directly. It pins all 42 gates above (equality, so a
dropped **or** widened gate fails), asserts every consumer role gets 403 while
`org_admin`/`super_admin` clear each gate, and checks the least-privilege
boundaries between the finance / staff / marketing / admin groups.
