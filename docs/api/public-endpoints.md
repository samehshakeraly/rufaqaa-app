# Public API endpoints

The `/api/v1/public/*` routes serve the anonymous-visitor surface. They require **no authentication** and have **no rate-limit exemption** beyond what the global middleware applies (60 requests/min per IP).

Every response shape here is **explicitly curated**. Adding a field is a security review, not a casual change — the test suite locks the shape against accidental leaks of `family_name`, `date_of_birth`, `address`, guardian / family / document data, donor history, etc.

## `GET /public/orphans`

Paginated list of orphans visitors can browse and sponsor.

### Query params

| Name | Type | Default | Notes |
|---|---|---|---|
| `limit` | int | 20 | 1–50 |
| `offset` | int | 0 | |
| `country` | string(2) | — | ISO alpha-2 |
| `gender` | `M` \| `F` | — | |
| `min_age` | int | — | years |
| `max_age` | int | — | years |

The endpoint filters internally to `case_status IN ('available', 'approved', 'reserved')` — visitors never see `pending_review`, `archived`, `deceased`, etc.

### Response

```json
{
  "items": [
    {
      "code": "ORP-AB12CD",
      "first_name": "Ahmad",
      "age_years": 8,
      "gender": "M",
      "country": "KW",
      "case_status": "available",
      "partner_organization_name": "شريك التطوير"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Fields deliberately NOT exposed**: `id`, `family_name`, `middle_name`, `father_name`, `date_of_birth`, `family_id`, `partner_organization_id`, `is_sponsored`, `current_balance`, `organization_id`, `deleted_at`, `created_at`.

## `GET /public/orphans/{code}`

Single-orphan detail. Same fields as the card plus `short_description: string | null` (a sanitized blurb that partners can author later — currently always `null`).

Returns **404** for any orphan that isn't in a browseable case status, even if the code is valid internally.

## `GET /public/stats`

Aggregate counters for the landing page. No row-level data crosses this boundary.

```json
{
  "orphans_available": 42,
  "orphans_sponsored": 17,
  "donors_total": 9,
  "countries_served": 3
}
```

## What the frontend uses

`frontend/src/lib/public.ts`:

- `listPublicOrphans(params)` → `PublicOrphansPage`
- `getPublicOrphan(code)` → `PublicOrphanDetail`
- `getPublicStats()` → `PublicStats`

Consumed by `LandingPage`, `PublicOrphansPage`, `PublicOrphanDetailPage`, and `SponsorCheckoutPage` (for the orphan card on the checkout screen).

## Tests

- Backend: `backend/tests/integration/test_public_endpoints.py` — locks response shape to a whitelist, asserts 404 on non-browseable orphans, asserts no `Authorization` header is required.
- E2E: `frontend/e2e/public-orphan-data-leak.spec.ts` — second-layer assertion that the browser-visible JSON has only the whitelisted keys.
