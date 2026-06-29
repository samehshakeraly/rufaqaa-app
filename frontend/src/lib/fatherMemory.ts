import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Father's memory (ذكرى الأب) — the guardian-consent gate that, TOGETHER with
// the `father_memory` profile-visibility toggle, discloses the deceased
// father's name + the YEAR of death on the donor profile. The two gates are
// independent: the block reaches the donor only when BOTH are on. Default is
// hidden until consent is explicitly recorded. Types mirror schema.gen.ts.
export type FatherMemoryConsent = components["schemas"]["FatherMemoryConsent"];

/** Staff read of the current guardian-consent state for one orphan. */
export async function getFatherMemoryConsent(orphanId: string): Promise<FatherMemoryConsent> {
  const { data } = await api.get<FatherMemoryConsent>(
    `/orphans/${orphanId}/father-memory-consent`,
  );
  return data;
}

/** Staff write — record or revoke guardian consent. Returns the updated state. */
export async function setFatherMemoryConsent(
  orphanId: string,
  consent: boolean,
): Promise<FatherMemoryConsent> {
  const { data } = await api.patch<FatherMemoryConsent>(
    `/orphans/${orphanId}/father-memory-consent`,
    { consent },
  );
  return data;
}
