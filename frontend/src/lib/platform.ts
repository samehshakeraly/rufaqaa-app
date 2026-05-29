import { api } from "./api";

/**
 * Client for the super-admin platform API (B-6) — cross-organization
 * reads/writes under `/platform/*`. Every endpoint here is gated on the
 * server to `super_admin`; org_admin must never reach it. These helpers
 * mirror the Pydantic schemas in `backend/app/schemas/platform.py`.
 */

export type OrgStatus = "active" | "suspended" | "archived" | "pending_approval";

export const ORG_TYPES = [
  "standalone",
  "external_marketer",
  "local_partner",
  "hybrid",
  "federated",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const DEPLOYMENT_MODES = ["self_hosted", "saas_cloud"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const ORG_STATUSES: OrgStatus[] = [
  "active",
  "suspended",
  "archived",
  "pending_approval",
];

export interface PlatformOrgSummary {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  country_code: string;
  status: string;
  subscription_plan: string | null;
  created_at: string;
  total_orphans: number;
  total_donors: number;
  total_sponsorships: number;
}

export interface PlatformOrgDetail extends PlatformOrgSummary {
  org_type: string;
  deployment_mode: string;
  timezone: string;
  default_language: string;
  default_currency: string;
  subscription_expires_at: string | null;
  settings: Record<string, unknown>;
  created_by: string | null;
  updated_at: string;
}

export interface PlatformOrgListParams {
  status?: string;
  country?: string;
  search?: string;
}

export async function listPlatformOrganizations(
  params: PlatformOrgListParams = {},
): Promise<PlatformOrgSummary[]> {
  const { data } = await api.get<PlatformOrgSummary[]>("/platform/organizations", {
    params: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.country ? { country: params.country } : {}),
      ...(params.search ? { search: params.search } : {}),
    },
  });
  return data;
}

export async function getPlatformOrganization(
  id: string,
): Promise<PlatformOrgDetail> {
  const { data } = await api.get<PlatformOrgDetail>(`/platform/organizations/${id}`);
  return data;
}

export interface PlatformOrgCreateInput {
  code: string;
  name_ar: string;
  name_en: string;
  country_code: string;
  default_currency: string;
  org_type: OrgType;
  deployment_mode: DeploymentMode;
  admin_email: string;
  admin_password: string;
  admin_first_name: string;
  admin_last_name: string;
}

export interface PlatformOrgCreateResponse {
  organization: PlatformOrgDetail;
  admin_user: { id: string; email: string };
}

export async function createPlatformOrganization(
  payload: PlatformOrgCreateInput,
): Promise<PlatformOrgCreateResponse> {
  const { data } = await api.post<PlatformOrgCreateResponse>(
    "/platform/organizations",
    payload,
  );
  return data;
}

export interface PlatformOrgUpdateInput {
  status?: OrgStatus;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
  settings?: Record<string, unknown>;
}

export async function updatePlatformOrganization(
  id: string,
  payload: PlatformOrgUpdateInput,
): Promise<PlatformOrgDetail> {
  const { data } = await api.patch<PlatformOrgDetail>(
    `/platform/organizations/${id}`,
    payload,
  );
  return data;
}

export async function suspendPlatformOrganization(
  id: string,
  reason: string,
): Promise<PlatformOrgDetail> {
  const { data } = await api.post<PlatformOrgDetail>(
    `/platform/organizations/${id}/suspend`,
    { reason },
  );
  return data;
}

export async function activatePlatformOrganization(
  id: string,
): Promise<PlatformOrgDetail> {
  const { data } = await api.post<PlatformOrgDetail>(
    `/platform/organizations/${id}/activate`,
    {},
  );
  return data;
}

// ── Platform settings (singleton) ────────────────────────────────────

export interface PlatformSettings {
  settings: Record<string, unknown>;
  updated_at: string | null;
  updated_by: string | null;
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const { data } = await api.get<PlatformSettings>("/platform/settings");
  return data;
}

export async function updatePlatformSettings(
  settings: Record<string, unknown>,
): Promise<PlatformSettings> {
  const { data } = await api.patch<PlatformSettings>("/platform/settings", {
    settings,
  });
  return data;
}
