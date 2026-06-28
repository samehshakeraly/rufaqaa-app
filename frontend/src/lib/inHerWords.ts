import type { components } from "@/api/schema.gen";

import { api } from "./api";

// "In Her Words" (بكلماتها) — curated, supervisor-authored child phrases shown
// on the donor profile, governed by the per-element visibility system. Types
// mirror schema.gen.ts exactly (PR-8 backend).
//
// `InHerWordsStaffItem` is the management view of one phrase: it carries the
// stable `id` (re-used across edits/reorders) plus the editable `text`/`said_on`.
// The donor projection (`SponsoredOrphanProfile.in_her_words`) drops the id —
// only text + said_on ever reach the donor.
export type InHerWordsStaffItem = components["schemas"]["InHerWordsStaffItem"];
export type InHerWordsItemUpdate = components["schemas"]["InHerWordsItemUpdate"];
export type InHerWordsList = components["schemas"]["InHerWordsList"];

/** Per-item / list limits — mirror the backend contract so client validation
 * matches the server (which 422s on violation). */
export const IN_HER_WORDS_MAX_LEN = 280;
export const IN_HER_WORDS_MAX_ITEMS = 20;

/** Staff read of the full ordered phrase list (incl. ids) for one orphan. */
export async function getInHerWords(orphanId: string): Promise<InHerWordsList> {
  const { data } = await api.get<InHerWordsList>(`/orphans/${orphanId}/in-her-words`);
  return data;
}

/** Staff write (replace semantics): the array order becomes the donor display
 * order. Returns the canonical, server-assigned list. */
export async function setInHerWords(
  orphanId: string,
  items: InHerWordsItemUpdate[],
): Promise<InHerWordsList> {
  const { data } = await api.put<InHerWordsList>(`/orphans/${orphanId}/in-her-words`, items);
  return data;
}
