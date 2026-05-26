import { api } from "./api";
import type { Page } from "./orphans";
import type { Report } from "./reports";
import type { Sponsorship } from "./sponsorships";

export async function fetchMySponsorships(donor_id?: string): Promise<Page<Sponsorship>> {
  const { data } = await api.get<Page<Sponsorship>>("/me/sponsorships", {
    params: { ...(donor_id ? { donor_id } : {}) },
  });
  return data;
}

export async function fetchMyReports(donor_id?: string): Promise<Page<Report>> {
  const { data } = await api.get<Page<Report>>("/me/reports", {
    params: { ...(donor_id ? { donor_id } : {}) },
  });
  return data;
}
