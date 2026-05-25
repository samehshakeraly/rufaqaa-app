import { api } from "./api";
import type { Page } from "./orphans";

export interface Partner {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  country_code: string;
  status: string;
}

export async function listPartners(): Promise<Page<Partner>> {
  const { data } = await api.get<Page<Partner>>("/partners", {
    params: { limit: 100 },
  });
  return data;
}
