import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Per-orphan wishes (R7) — staff CRUD over the `orphan_wishes` rows.
// Types mirror schema.gen.ts exactly. `WishRead` is the STAFF view (id,
// timestamps and the staff-only `internal_note`); the donor projection
// (`SponsoredOrphanProfile.wishes`) is a strict allowlist composed
// server-side — the internal note never reaches a donor. `raised_amount` is
// SYSTEM-managed (R8's payment webhook) and read-only on every staff surface.
export type WishRead = components["schemas"]["WishRead"];
export type WishCreate = components["schemas"]["WishCreate"];
export type WishUpdate = components["schemas"]["WishUpdate"];

/** Coded lifecycle — mirrors the backend `WishStatus` Literal (which 422s on
 * anything else). Each value has an ar/en label under `orphanWishes.status.*`. */
export const WISH_STATUSES = ["open", "fulfilled", "archived"] as const;

/** Mirror of the backend title cap (422 on violation). */
export const WISH_TITLE_MAX_LEN = 120;

/** Staff read of an orphan's full wishes list (incl. the staff-only internal note). */
export async function listWishes(orphanId: string): Promise<WishRead[]> {
  const { data } = await api.get<WishRead[]>(`/orphans/${orphanId}/wishes`);
  return data;
}

/** Staff create of one wish for an orphan (starts at raised 0 / status open). */
export async function createWish(orphanId: string, body: WishCreate): Promise<WishRead> {
  const { data } = await api.post<WishRead>(`/orphans/${orphanId}/wishes`, body);
  return data;
}

/** Staff partial update of one wish (only supplied fields change; `status`
 * is the controlled lifecycle transition). */
export async function updateWish(wishId: string, body: WishUpdate): Promise<WishRead> {
  const { data } = await api.patch<WishRead>(`/wishes/${wishId}`, body);
  return data;
}

/** Staff hard-delete of one wish. */
export async function deleteWish(wishId: string): Promise<void> {
  await api.delete(`/wishes/${wishId}`);
}
