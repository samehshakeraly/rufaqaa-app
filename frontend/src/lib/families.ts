import { api } from "./api";
import type { Page } from "./orphans";

export interface Family {
  id: string;
  code: string;
  family_name: string | null;
  deceased_father_name: string | null;
  father_death_date: string | null;
  country_code: string | null;
  city: string | null;
  housing_status: string | null;
  monthly_income: string | null;
  income_currency: string | null;
  created_at: string;
}

export interface FamilyCreateInput {
  family_name?: string;
  deceased_father_name?: string;
  father_death_date?: string;
  country_code?: string;
  city?: string;
  housing_status?: "owned" | "rented" | "donated" | "homeless";
  monthly_income?: string;
  income_currency?: string;
  partner_organization_id?: string;
}

export interface Guardian {
  id: string;
  family_id: string | null;
  full_name: string;
  relation: string;
  occupation: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  created_at: string;
}

export interface GuardianCreateInput {
  full_name: string;
  relation:
    | "mother"
    | "father"
    | "grandfather"
    | "grandmother"
    | "uncle"
    | "aunt"
    | "sibling"
    | "other";
  occupation?: string;
  phone?: string;
  email?: string;
  family_id?: string;
}

export async function listFamilies(params?: {
  limit?: number;
  offset?: number;
}): Promise<Page<Family>> {
  const { data } = await api.get<Page<Family>>("/families", { params });
  return data;
}

export async function createFamily(payload: FamilyCreateInput): Promise<Family> {
  const { data } = await api.post<Family>("/families", payload);
  return data;
}

export async function getFamily(id: string): Promise<Family> {
  const { data } = await api.get<Family>(`/families/${id}`);
  return data;
}

export async function listFamilyGuardians(familyId: string): Promise<Page<Guardian>> {
  const { data } = await api.get<Page<Guardian>>(`/families/${familyId}/guardians`);
  return data;
}

export async function createGuardian(
  familyId: string,
  payload: GuardianCreateInput,
): Promise<Guardian> {
  const { data } = await api.post<Guardian>(
    `/families/${familyId}/guardians`,
    payload,
  );
  return data;
}
