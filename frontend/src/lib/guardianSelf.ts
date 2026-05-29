import { api } from "./api";
import type { Report } from "./reports";

/**
 * Guardian self-service client — mirrors `donorAuth.ts`.
 *
 * Privacy note: the backend projections (`GuardianMeRead`,
 * `GuardianOrphanRead`) deliberately omit donor identity, contact info,
 * and financial figures. The only financial signal that can ever appear
 * is the optional `financials` sub-object (org opt-in via
 * `business_rules.show_financial_to_guardian`); even then the UI must
 * render at most a "sponsored" badge — never raw amounts. We do NOT make
 * any extra calls to re-derive hidden fields.
 */

export interface GuardianFamilyMini {
  id: string;
  code: string;
  family_name: string | null;
  country_code: string | null;
  governorate: string | null;
}

export interface GuardianProfile {
  id: string;
  user_id: string | null;
  full_name: string;
  relation: string;
  literacy_level: string;
  preferred_communication: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  status: string;
  family: GuardianFamilyMini | null;
}

/** Optional financial payload — only present when the org opted in. We
 * never surface the numbers; presence + `is_sponsored` drive a badge. */
export interface GuardianOrphanFinancials {
  current_balance: string | null;
  balance_currency: string | null;
  is_sponsored: boolean;
}

export interface GuardianOrphan {
  id: string;
  code: string;
  first_name: string;
  family_name: string;
  date_of_birth: string;
  gender: string;
  case_status: string;
  profile_completion_percentage: number;
  financials: GuardianOrphanFinancials | null;
}

export async function getGuardianMe(): Promise<GuardianProfile> {
  const { data } = await api.get<GuardianProfile>("/guardian/me");
  return data;
}

export async function listMyOrphans(): Promise<GuardianOrphan[]> {
  const { data } = await api.get<GuardianOrphan[]>("/guardian/me/orphans");
  return data;
}

export async function listMyReports(
  orphanId: string,
  limit?: number,
): Promise<Report[]> {
  const { data } = await api.get<Report[]>("/guardian/me/reports", {
    params: { orphan_id: orphanId, limit },
  });
  return data;
}
