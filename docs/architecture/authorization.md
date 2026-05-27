# Authorization model

Three independent layers. Each is enforced server-side; the SPA mirrors the rules for UX gating only.

## 1. Roles

`users.role` is a free-text column with a CHECK constraint. The values in active use:

| Role | Who | Reachable via |
|---|---|---|
| `super_admin` | Platform operator | Always; bypasses every `require_roles` check |
| `org_admin` | Tenant administrator | Admin area |
| `partner_manager` / `partner_staff` | Partner-org staff | Admin area, scoped views |
| `marketing_manager` / `finance` | Internal staff | Admin area, scoped views |
| `donor` | Public donor (signup) | Donor area only |
| `guardian` / `orphan` / `viewer` | Reserved, unused today | — |

The role groupings live in `app/core/authz.py`:

```python
ADMIN_ROLES = ("super_admin", "org_admin")
STAFF_ROLES = ADMIN_ROLES + ("partner_manager", "partner_staff",
                            "marketing_manager", "finance")
DONOR_ROLE = "donor"
```

## 2. Dependencies

Every route declares the minimum role(s) it accepts.

- `require_roles(*allowed)` — at-least-one-of check. `super_admin` always passes.
- `require_verified_donor()` — caller must be `role='donor'` (or `super_admin`) AND have a non-null `email_verified_at`. Used for state-changing donor routes (`/donor/me/sponsorships POST`, `/payments/initiate` when invoked as a donor).

Public endpoints declare neither; the FastAPI dependency is just `DbSession`.

## 3. RLS

Every multi-tenant table (`users`, `donors`, `orphans`, `sponsorships`, `payments`, `documents`, `marketing_channels`, …) enables Postgres Row-Level Security with the policy:

```sql
USING (organization_id = current_setting('app.current_org_id', true)::uuid)
```

The dependency `DbSession` sets `app.current_org_id` per request from the authenticated user's `organization_id`. Public endpoints connect as the table owner (`rufaqaa`) which bypasses RLS — this is intentional and the response shape is what stops sensitive fields from leaking.

## 4. Frontend route guards

Three guards live in `frontend/src/components/`:

- **`PublicRoute`** (none today — anon is the default; `PublicLayout` is just the chrome). Pages reachable without a token: `/`, `/orphans`, `/orphans/:code`, `/signup`, `/verify-email`, `/verify-email/confirm`, `/login`, `/forgot-password`, `/reset-password`.
- **`DonorRoute`** — requires a token, `role='donor'` (or super_admin), and `email_verified_at IS NOT NULL`. Pushes anon to `/login`, staff to `/admin/dashboard`, unverified donor to `/verify-email`.
- **`AdminRoute`** — wraps the `ProtectedRoute` mount + role check for org admins only. Used on `/admin/users`, `/admin/audit`, `/admin/marketing-channels`, `/admin/bank-transfers`.

`useRole()` exposes `isAdmin / isStaff / isDonor / emailVerified / homePath` so components can branch on auth state without re-running the guard logic.

## 5. The donor isolation guarantee

The most important non-obvious property: **donor A cannot read or mutate donor B's data**.

How it's enforced:

1. Every `/donor/me/*` endpoint resolves the calling donor via `Donor.user_id == current_user.id` (one row, by construction unique because `donors.user_id` is `UNIQUE`).
2. Subsequent queries always join through that donor row — they never accept a donor id from the request.
3. `/payments/initiate` explicitly checks `donor.user_id == current_user.id` when the caller is `role='donor'` and returns 403 otherwise.
4. The Playwright spec `donor-isolation.spec.ts` exercises this against the live stack.

## 6. Anti-enumeration

Three flows return identical response shapes regardless of whether a record exists:

- `POST /auth/signup` (existing vs. new email)
- `POST /auth/forgot-password` (existing vs. unknown email)
- `POST /auth/resend-verification` (existing vs. unknown email)

In each case the `debug_*_token` field is only populated when the underlying account actually exists and the action made sense. In production (`settings.ENVIRONMENT == "production"`) those debug fields are always `None`.

## 7. Rate limiting

`app/core/ratelimit.py` enforces per-IP / per-token limits via either an in-memory token bucket (dev) or a Redis-backed sliding-window counter (prod, `RATE_LIMIT_BACKEND=redis`). The public + signup endpoints get the **anonymous** quota; authenticated routes get the **authenticated** quota.

## 8. What an admin can do that a donor cannot

- See other donors' records, payments, sponsorships
- Create / suspend / reactivate users
- Initiate refunds (`POST /payments/{id}/refund`)
- Manage partner organizations, marketing channels, bank transfers
- View the audit log
- Initiate payments on behalf of any donor in their org

What a donor can do that an admin cannot directly: initiate a payment as themselves (admin can do this *for* them, but the resulting payment row carries the donor's user as `created_by` only in the donor case).
