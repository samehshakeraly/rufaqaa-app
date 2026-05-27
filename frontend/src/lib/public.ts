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

export async function getPublicStats(): Promise<PublicStats> {
  const { data } = await api.get<PublicStats>("/public/stats");
  return data;
}
