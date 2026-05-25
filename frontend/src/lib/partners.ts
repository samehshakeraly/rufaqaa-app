import { api } from "./api";
import type { Page } from "./orphans";

export interface Partner {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  country_code: string;
  status: "active" | "suspended" | "archived";
  created_at: string;
}

export interface PartnerCreateInput {
  name_ar: string;
  name_en?: string;
  country_code: string;
  contact_email?: string;
  contact_phone?: string;
  contact_person?: string;
}

export async function listPartners(includeInactive = false): Promise<Page<Partner>> {
  const { data } = await api.get<Page<Partner>>("/partners", {
    params: { limit: 100, include_inactive: includeInactive },
  });
  return data;
}

export async function createPartner(payload: PartnerCreateInput): Promise<Partner> {
  const { data } = await api.post<Partner>("/partners", payload);
  return data;
}

export async function archivePartner(id: string): Promise<void> {
  await api.delete(`/partners/${id}`);
}
