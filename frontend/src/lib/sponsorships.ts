import { api } from "./api";
import type { Page } from "./orphans";

export interface Sponsorship {
  id: string;
  code: string;
  donor_id: string;
  orphan_id: string;
  monthly_amount: string;
  currency: string;
  start_date: string;
  end_date: string | null;
  payment_frequency: string;
  status: string;
  total_paid: string;
  payments_count: number;
  next_payment_date: string | null;
  created_at: string;
  donor_code: string | null;
  donor_name: string | null;
  orphan_code: string | null;
  orphan_name: string | null;
}

export interface SponsorshipCreateInput {
  donor_id: string;
  orphan_id: string;
  monthly_amount: string;
  currency: string;
  start_date: string;
  payment_frequency?: string;
  payment_method?: string;
  notes?: string;
}

export async function listSponsorships(params?: {
  limit?: number;
  offset?: number;
  donor_id?: string;
  orphan_id?: string;
  status?: string;
}): Promise<Page<Sponsorship>> {
  const { data } = await api.get<Page<Sponsorship>>("/sponsorships", { params });
  return data;
}

/** Donor self-service: every sponsorship belonging to the calling
 * donor, full `SponsorshipRead` shape (includes `orphan_id`,
 * `next_payment_date`, `total_paid`). The backend pins the result to
 * the donor linked to the auth token — a donor can never read another
 * donor's rows. */
export async function listMySponsorships(params?: {
  limit?: number;
  offset?: number;
}): Promise<Page<Sponsorship>> {
  const { data } = await api.get<Page<Sponsorship>>("/me/sponsorships", {
    params,
  });
  return data;
}

export async function createSponsorship(
  payload: SponsorshipCreateInput,
): Promise<Sponsorship> {
  const { data } = await api.post<Sponsorship>("/sponsorships", payload);
  return data;
}

export async function cancelSponsorship(
  id: string,
  reason?: string,
): Promise<Sponsorship> {
  const { data } = await api.post<Sponsorship>(`/sponsorships/${id}/cancel`, {
    reason: reason ?? null,
  });
  return data;
}

export async function pauseSponsorship(id: string): Promise<Sponsorship> {
  const { data } = await api.post<Sponsorship>(`/sponsorships/${id}/pause`);
  return data;
}

export async function resumeSponsorship(id: string): Promise<Sponsorship> {
  const { data } = await api.post<Sponsorship>(`/sponsorships/${id}/resume`);
  return data;
}

export async function exportSponsorshipsCsv(params?: {
  donor_id?: string;
  orphan_id?: string;
  status?: string;
}): Promise<Blob> {
  const r = await api.get("/sponsorships/export.csv", {
    params,
    responseType: "blob",
  });
  return r.data as Blob;
}
