# 1. Block self-approval on orphan approval

- Status: Accepted
- Date: 2026-06-16

## Context

Orphan records move `pending_review → approved` through
`POST /orphans/{id}/approve`. Two role groups overlap on this gate:
`ORPHAN_CREATOR_ROLES` (partner_staff, partner_manager, + admins) may register
a record, and `PARTNER_APPROVER_ROLES` (partner_manager + admins) may approve
one. A **partner_manager holds both roles**, so it could create an orphan and
then approve its own submission — a segregation-of-duties (SoD) gap. The data
needed to detect this already exists: `created_by` is stamped at creation in
`services/orphans.py`.

## Decision

`approve_orphan` rejects self-approval — a non-admin approver may not approve a
record they created:

```python
if user.role not in ADMIN_ROLES and orphan.created_by == user.id:
    raise HTTPException(403, "You cannot approve an orphan record you created")
```

The check sits **after** the partner-scope (جهة) fence and **before** the
case-status transition check, so an out-of-جهة record still 404s first
(existence stays hidden) and the SoD 403 takes precedence over a 409.

- **partner_manager is the affected role** — this closes its creator +
  approver dual role on a single record (four-eyes on approval).
- **Admins (`ADMIN_ROLES`: super_admin, org_admin) are exempt.** They are the
  escalation path; exempting them keeps a single-admin organisation from
  deadlocking when its only admin both creates and approves. A `NULL`
  `created_by` never equals a real user id, so it never blocks.

## Scope / non-goals

Applies to `approve_orphan` **only**:

- **`reject_orphan` is unchanged** — declining your own submission is not an
  SoD violation.
- **`release_orphan` is unchanged** — it is a post-approval state change
  (approved/reserved → available), not the approval control gate.

The role groups (`ORPHAN_CREATOR_ROLES` / `PARTNER_APPROVER_ROLES`) are left
as-is; SoD is enforced per-record via `created_by`, not by narrowing roles.

## Consequences

- A partner_manager who registers an orphan now needs a second partner_manager
  (or an admin) to approve it — the intended control.
- A جهة staffed with a single partner_manager must add a second approver (or
  rely on an admin) to clear that جهة's intake.
