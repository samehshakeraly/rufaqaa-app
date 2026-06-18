# 0002 — Partner-manager dual role: resolution

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

`partner_manager` is the only non-admin role that sits in both
`ORPHAN_CREATOR_ROLES` and `PARTNER_APPROVER_ROLES` (see `backend/app/api/v1/orphans.py`):
it can register an orphan record *and* approve, reject, or release one. This
raised a segregation-of-duties question — should a single role hold both the
submit and the review capability on orphan records?

ADR 0001 already addressed the sharp edge: a manager cannot approve a record
they themselves created (`created_by == user.id` → 403, admins exempt). The
remaining open question was the broader role design and the single-manager
partner organization, where there may be no second `partner_manager` to act as
approver.

## Decision

No code change. The dual capability is retained as designed, because the
segregation that matters is enforced at the record level by ADR 0001, not by
splitting the role:

- A `partner_manager` creating one record and approving a *different* record
  (e.g. another manager's submission) is the intended, normal workflow — it is
  not a violation and must stay supported.
- For a partner organization with only one `partner_manager`, the sanctioned
  approver of that manager's submissions is an admin in `PARTNER_APPROVER_ROLES`
  (`super_admin` / `org_admin`), who are exempt from the self-approval block.
  This escalation path already exists; no record can deadlock.
- An automatic approval-escalation mechanism was considered and rejected: it
  adds a new trust path and complexity for marginal benefit, and granting
  approval authority automatically would weaken — not strengthen — segregation
  of duties.

Role groups (`ORPHAN_CREATOR_ROLES`, `PARTNER_APPROVER_ROLES`) are unchanged.

## Consequences

- The `partner_manager` dual-role question is closed: segregation of duties is
  guaranteed per-record by ADR 0001, and single-manager organizations rely on
  the existing admin approver path.
- Operational follow-up (owned outside code): partner-organization onboarding
  should recommend at least two `partner_manager` accounts per جهة, so approval
  stays inside the organization rather than escalating to an admin. This is a
  policy/onboarding decision, not an authorization rule.
- Supersedes nothing; complements ADR 0001 as the higher-level rationale for why
  the dual role is acceptable.
