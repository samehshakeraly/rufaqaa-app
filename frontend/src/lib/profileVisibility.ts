import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Donor-profile visibility types — mirror schema.gen.ts exactly (PR-1 backend).
// A ProfileElement is shown to the donor UNLESS its key is explicitly `false`;
// the default ({}) is "all visible". Hiding is enforced server-side — a hidden
// element never leaves the server — so this is not cosmetic.
export type ProfileElement = components["schemas"]["ProfileElement"];
export type ProfileElementState = components["schemas"]["ProfileElementState"];
export type ProfileVisibilityRegistry = components["schemas"]["ProfileVisibilityRegistry"];

// The full set of toggleable elements, in the donor-page display order. The
// identity/header block is intentionally absent — it is implicit and always
// shown, never a ProfileElement.
export const PROFILE_ELEMENTS: readonly ProfileElement[] = [
  "dream",
  "her_world",
  "quran_growth",
  "multidim_growth",
  "milestones",
  "recent_updates",
  "supervisor_word",
  "since_you_began",
  "in_her_words",
  "father_memory",
  "health",
  "home",
  "guardian",
  "siblings",
  "skills",
  "independence",
] as const;

/** Staff read of the donor-profile visibility registry for one orphan. */
export async function getProfileVisibility(orphanId: string): Promise<ProfileVisibilityRegistry> {
  const { data } = await api.get<ProfileVisibilityRegistry>(
    `/orphans/${orphanId}/profile-visibility`,
  );
  return data;
}

/** Staff write (replace semantics): send every ProfileElement key explicitly.
 * Returns the recomputed registry. */
export async function setProfileVisibility(
  orphanId: string,
  visibility: Record<ProfileElement, boolean>,
): Promise<ProfileVisibilityRegistry> {
  const { data } = await api.put<ProfileVisibilityRegistry>(
    `/orphans/${orphanId}/profile-visibility`,
    { visibility },
  );
  return data;
}
