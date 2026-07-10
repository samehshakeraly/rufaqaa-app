import { api } from "./api";

export interface Organization {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  org_type: string;
  deployment_mode: string;
  country_code: string;
  timezone: string;
  default_language: string;
  default_currency: string;
  logo_url: string | null;
  primary_color: string;
  status: string;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  report_cadence_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationUpdateInput {
  name_ar?: string;
  name_en?: string;
  country_code?: string;
  timezone?: string;
  default_language?: string;
  default_currency?: string;
  logo_url?: string;
  primary_color?: string;
  /** null clears the cadence back to the platform default (90 days). */
  report_cadence_days?: number | null;
}

export async function fetchOrganization(): Promise<Organization> {
  const { data } = await api.get<Organization>("/organization");
  return data;
}

export async function updateOrganization(
  payload: OrganizationUpdateInput,
): Promise<Organization> {
  const { data } = await api.patch<Organization>("/organization", payload);
  return data;
}
