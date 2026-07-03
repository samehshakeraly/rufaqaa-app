import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Per-orphan skills/talents (R5) — staff CRUD over the `orphan_skills` rows.
// Types mirror schema.gen.ts exactly. `SkillRead` is the STAFF view (id,
// timestamps and the staff-only `note`); the donor projection
// (`SponsoredOrphanProfile.skills`) is a strict name/category/level allowlist
// composed server-side — the note never reaches a donor.
export type SkillRead = components["schemas"]["SkillRead"];
export type SkillCreate = components["schemas"]["SkillCreate"];
export type SkillUpdate = components["schemas"]["SkillUpdate"];

/** Coded vocabularies — mirror the backend `SkillCategory`/`SkillLevel`
 * Literals (which 422 on anything else). Each value has an ar/en label under
 * `orphanSkills.category.*` / `orphanSkills.level.*`. */
export const SKILL_CATEGORIES = [
  "quran",
  "academic",
  "arts",
  "sports",
  "languages",
  "crafts",
  "social",
  "other",
] as const;
export const SKILL_LEVELS = ["beginner", "intermediate", "advanced"] as const;

/** Mirror of the backend name cap (422 on violation). */
export const SKILL_NAME_MAX_LEN = 60;

/** Staff read of an orphan's full skills list (incl. the staff-only note). */
export async function listSkills(orphanId: string): Promise<SkillRead[]> {
  const { data } = await api.get<SkillRead[]>(`/orphans/${orphanId}/skills`);
  return data;
}

/** Staff create of one skill for an orphan. */
export async function createSkill(orphanId: string, body: SkillCreate): Promise<SkillRead> {
  const { data } = await api.post<SkillRead>(`/orphans/${orphanId}/skills`, body);
  return data;
}

/** Staff partial update of one skill (only supplied fields change). */
export async function updateSkill(skillId: string, body: SkillUpdate): Promise<SkillRead> {
  const { data } = await api.patch<SkillRead>(`/skills/${skillId}`, body);
  return data;
}

/** Staff hard-delete of one skill. */
export async function deleteSkill(skillId: string): Promise<void> {
  await api.delete(`/skills/${skillId}`);
}
