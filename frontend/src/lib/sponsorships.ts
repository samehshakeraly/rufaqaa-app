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
