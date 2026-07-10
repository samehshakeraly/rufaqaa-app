import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Types track schema.gen.ts (regenerated from the backend OpenAPI spec).
export type CommunityFollowupReport = components["schemas"]["CommunityFollowupReport"];
export type GovernorateFollowup = components["schemas"]["GovernorateFollowup"];

/** Aggregate community follow-up report over the out-of-home orphans —
 * children living with family, not in a dar. Counts only, zero PII. The
 * backend scopes to the caller's org / جهة, and governorates below the
 * k-anonymity floor arrive already merged into "other". */
export async function getCommunityFollowupReport(): Promise<CommunityFollowupReport> {
  const { data } = await api.get<CommunityFollowupReport>("/orphans/community-report");
  return data;
}
