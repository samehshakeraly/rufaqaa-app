import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Per-orphan needs (R7) — staff CRUD over the `orphan_needs` rows.
// Types mirror schema.gen.ts exactly. `NeedRead` is the STAFF view (id,
// timestamps and the staff-only `internal_note`); the donor projection
// (`SponsoredOrphanProfile.needs`) is a strict allowlist composed
// server-side — the internal note never reaches a donor. `raised_amount` is
// SYSTEM-managed (R8's payment webhook) and read-only on every staff surface.
export type NeedRead = components["schemas"]["NeedRead"];
export type NeedCreate = components["schemas"]["NeedCreate"];
export type NeedUpdate = components["schemas"]["NeedUpdate"];

/** Coded vocabularies — mirror the backend `NeedStatus`/`NeedCategory`
 * Literals (which 422 on anything else). Each value has an ar/en label under
 * `orphanNeeds.status.*` / `orphanNeeds.category.*`. */
export const NEED_STATUSES = ["open", "met", "archived"] as const;
export const NEED_CATEGORIES = [
  "rent",
  "medicine",
  "supplies",
  "clothing",
  "education",
  "food",
  "other",
] as const;

/** Mirror of the backend title cap (422 on violation). */
export const NEED_TITLE_MAX_LEN = 120;

/** Staff read of an orphan's full needs list (incl. the staff-only internal note). */
export async function listNeeds(orphanId: string): Promise<NeedRead[]> {
  const { data } = await api.get<NeedRead[]>(`/orphans/${orphanId}/needs`);
  return data;
}

/** Staff create of one need for an orphan (starts at raised 0 / status open). */
export async function createNeed(orphanId: string, body: NeedCreate): Promise<NeedRead> {
  const { data } = await api.post<NeedRead>(`/orphans/${orphanId}/needs`, body);
  return data;
}

/** Staff partial update of one need (only supplied fields change; `status`
 * is the controlled lifecycle transition). */
export async function updateNeed(needId: string, body: NeedUpdate): Promise<NeedRead> {
  const { data } = await api.patch<NeedRead>(`/needs/${needId}`, body);
  return data;
}

/** Staff hard-delete of one need. */
export async function deleteNeed(needId: string): Promise<void> {
  await api.delete(`/needs/${needId}`);
}
