import { api } from "./api";
import type { Page } from "./orphans";

export interface Donor {
  id: string;
  code: string;
  full_name: string;
  email: string;
  phone: string | null;
  country_of_residence: string | null;
  preferred_currency: string | null;
  status: string;
  total_sponsorships: number;
  active_sponsorships: number;
  total_donated: string;
  created_at: string;
}

export interface DonorCreateInput {
  full_name: string;
  email: string;
  phone?: string;
  country_of_residence?: string;
  preferred_currency?: string;
}

export async function listDonors(params?: {
  limit?: number;
  offset?: number;
}): Promise<Page<Donor>> {
  const { data } = await api.get<Page<Donor>>("/donors", { params });
  return data;
}

export async function createDonor(payload: DonorCreateInput): Promise<Donor> {
  const { data } = await api.post<Donor>("/donors", payload);
  return data;
}
