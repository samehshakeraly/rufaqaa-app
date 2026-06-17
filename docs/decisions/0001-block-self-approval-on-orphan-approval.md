# 0001 — Block self-approval on orphan approval

- **Status:** Accepted
- **Date:** 2026-06-17

## Context

Orphan records move through a case-status workflow: `partner_staff` (or anyone
in `ORPHAN_CREATOR_ROLES`) registers an orphan, which lands in `pending_review`;
a reviewer in `PARTNER_APPROVER_ROLES` (`partner_manager` + admins) then
approves, rejects, or releases it.

`partner_manager` sits in **both** groups — it can create an orphan *and*
approve one. Nothing stopped a manager from registering a record and then
approving their own submission, collapsing the submit/review split into a single
actor. `orphans.created_by` is already stamped at creation
(`services/orphans.py`), so the data needed to detect this case already exists.

## Decision

In `approve_orphan` (`backend/app/api/v1/orphans.py`), after the partner-جهة
scope fence and before the case-status transition check, reject a self-approval:

```python
if user.role not in ADMIN_ROLES and orphan.created_by == user.id:
    raise HTTPException(403, "You cannot approve an orphan record you created")
```

- **Who is affected:** `partner_manager` — the only non-admin role that can both
  create and approve. `partner_staff` already cannot approve (role gate), so the
  guard is a no-op for them.
- **Admins are exempt:** `ADMIN_ROLES` (`super_admin`, `org_admin`) skip the
  check. They are the escalation path; exempting them keeps a single-admin
  organization from deadlocking on its own records.
- **NULL `created_by` never blocks:** a missing creator never equals a real user
  id, so legacy/system-created rows stay approvable.

Role groups are unchanged — `ORPHAN_CREATOR_ROLES` and `PARTNER_APPROVER_ROLES`
stay as-is. This is a per-record actor check, not a role change.

## Consequences

- Closes the `partner_manager` dual-role on a single record without removing the
  role's ability to approve *other* managers' submissions.
- A `pending_review` record created by the only available `partner_manager` now
  needs a different `partner_manager` or an admin to approve it — the intended
  segregation of duties.
- **`reject` and `release` are deliberately excluded.** Rejecting your own draft
  is self-correction, not an approval that confers legitimacy; release only moves
  an already-approved/reserved record back to the available pool and so cannot be
  used to launder an unreviewed record into an approved state. Fencing only the
  approval keeps the control tight to the risk.
