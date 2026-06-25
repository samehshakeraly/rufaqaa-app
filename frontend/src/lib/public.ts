import { api } from "./api";

export interface PublicOrphan {
  code: string;
  first_name: string;
  age_years: number;
  gender: "M" | "F";
  country: string | null;
  case_status: string;
  partner_organization_name: string | null;
}

export interface PublicOrphanDetail extends PublicOrphan {
  short_description: string | null;
  // Donor-safe humanizing profile slice (see backend PublicOrphanDetail).
  // Sensitive fields (health, challenges, school, family, documents) are
  // intentionally never sent on this surface.
  aspiration: string | null;
  /** Education-stage enum code (e.g. "primary"); localized on the client. */
  education_stage: string | null;
  quran_juz_memorized: number | null;
  is_hafiz: boolean;
  tags: string[];
}

export interface PublicOrphansPage {
  items: PublicOrphan[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublicStats {
  orphans_available: number;
  orphans_sponsored: number;
  donors_total: number;
  countries_served: number;
}

export async function listPublicOrphans(params: {
  limit?: number;
  offset?: number;
  country?: string;
  gender?: "M" | "F";
  min_age?: number;
  max_age?: number;
}): Promise<PublicOrphansPage> {
  const { data } = await api.get<PublicOrphansPage>("/public/orphans", { params });
  return data;
}

export async function getPublicOrphan(code: string): Promise<PublicOrphanDetail> {
  const { data } = await api.get<PublicOrphanDetail>(`/public/orphans/${code}`);
  return data;
}

/**
 * Donor-scoped twin of {@link getPublicOrphan}: returns the SAME donor-safe
 * profile shape, but for a child the caller actually sponsors — keyed by
 * orphan id and scoped by sponsorship, so a sponsored child (no longer
 * publicly browseable) still resolves.
 */
export async function getSponsoredOrphanProfile(
  orphanId: string,
): Promise<PublicOrphanDetail> {
  const { data } = await api.get<PublicOrphanDetail>(
    `/me/sponsorships/${orphanId}/profile`,
  );
  return data;
}

export async function getPublicStats(): Promise<PublicStats> {
  const { data } = await api.get<PublicStats>("/public/stats");
  return data;
}
