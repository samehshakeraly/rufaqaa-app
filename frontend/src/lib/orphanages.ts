import type { components } from "@/api/schema.gen";

import { api } from "./api";
import type { Page } from "./orphans";

// Types track schema.gen.ts (regenerated from the backend OpenAPI spec).
export type Orphanage = components["schemas"]["OrphanageRead"];
export type OrphanageCreateInput = components["schemas"]["OrphanageCreate"];
export type OrphanageUpdateInput = components["schemas"]["OrphanageUpdate"];
export type OrphanageStatus = Orphanage["status"];
export type OrphanageReport = components["schemas"]["OrphanageReport"];

export const ORPHANAGE_STATUSES = ["active", "inactive", "archived"] as const;

export async function listOrphanages(params?: {
  limit?: number;
  offset?: number;
}): Promise<Page<Orphanage>> {
  const { data } = await api.get<Page<Orphanage>>("/orphanages", { params });
  return data;
}

export async function createOrphanage(payload: OrphanageCreateInput): Promise<Orphanage> {
  const { data } = await api.post<Orphanage>("/orphanages", payload);
  return data;
}

export async function getOrphanage(id: string): Promise<Orphanage> {
  const { data } = await api.get<Orphanage>(`/orphanages/${id}`);
  return data;
}

export async function updateOrphanage(
  id: string,
  payload: OrphanageUpdateInput,
): Promise<Orphanage> {
  const { data } = await api.patch<Orphanage>(`/orphanages/${id}`, payload);
  return data;
}

/** Aggregate "house report" for one dar — counts only, zero PII. The
 * backend scopes visibility (org / جهة / the dar's own manager) and 404s
 * anything outside the caller's reach. */
export async function getOrphanageReport(id: string): Promise<OrphanageReport> {
  const { data } = await api.get<OrphanageReport>(`/orphanages/${id}/report`);
  return data;
}
