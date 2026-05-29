import { AxiosError } from "axios";

import { api } from "./api";

/**
 * Orphan self-service API client.
 *
 * Mirrors `donorAuth.ts` / `guardianSelf` patterns. Every type here is
 * the privacy-safe projection the backend returns (see
 * backend/app/api/v1/orphan_self.py). This portal serves MINORS, so the
 * wire shapes never carry donor identity, amounts, currency, balances,
 * or guardian/partner PII — do not add fields that would.
 */

/** GET /orphan/me — the orphan's own profile. No financial/partner/
 * guardian fields. */
export interface OrphanProfile {
  id: string;
  code: string;
  first_name: string;
  family_name: string;
  date_of_birth: string;
  gender: string;
  profile_completion_percentage: number;
}

/** GET /orphan/me/sponsor — minimal, child-safe sponsor view.
 *
 * `display_name` is either the literal "كفيلك" or the donor's first name
 * (only when the org opted in). NEVER an amount, currency, full name,
 * email, phone, or sponsorship id. `since_year` is a plain calendar year
 * for textual "since N years" rendering — never a financial figure. */
export interface OrphanSponsorView {
  has_sponsor: boolean;
  display_name?: string | null;
  since_year?: number | null;
}

/** GET /orphan/me/achievements — a published report projected to the
 * progress fields only. The JSON blobs are free-form; render defensively. */
export interface OrphanAchievement {
  id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  educational_progress?: Record<string, unknown> | null;
  quran_progress?: Record<string, unknown> | null;
  activities?: Record<string, unknown> | null;
}

/** Message projection — only `from_role` + `from_name` (first name).
 * No raw user ids, email, phone, or last name. */
export interface OrphanMessage {
  id: string;
  from_role: string;
  from_name: string;
  message_type: string;
  content: string | null;
  moderation_status: string;
  is_read: boolean;
  is_mine: boolean;
  created_at?: string | null;
}

export async function getOrphanMe(): Promise<OrphanProfile> {
  const { data } = await api.get<OrphanProfile>("/orphan/me");
  return data;
}

export async function getOrphanSponsor(): Promise<OrphanSponsorView> {
  const { data } = await api.get<OrphanSponsorView>("/orphan/me/sponsor");
  return data;
}

export async function listOrphanAchievements(
  limit = 20,
): Promise<OrphanAchievement[]> {
  const { data } = await api.get<OrphanAchievement[]>(
    "/orphan/me/achievements",
    { params: { limit } },
  );
  return data;
}

export async function listOrphanMessages(limit = 50): Promise<OrphanMessage[]> {
  const { data } = await api.get<OrphanMessage[]>("/orphan/me/messages", {
    params: { limit },
  });
  return data;
}

export async function sendOrphanMessage(content: string): Promise<OrphanMessage> {
  const { data } = await api.post<OrphanMessage>("/orphan/me/messages", {
    content,
    message_type: "text",
  });
  return data;
}

/**
 * True when an error is the backend's age-gate refusal (403 with
 * `detail.code === "AGE_GATE"`). The portal must render a friendly
 * message and withhold all content in this case — never a redirect to
 * the public landing.
 */
export function isAgeGateError(err: unknown): boolean {
  if (!(err instanceof AxiosError)) return false;
  if (err.response?.status !== 403) return false;
  const detail = (err.response?.data as { detail?: unknown } | undefined)
    ?.detail;
  return (
    typeof detail === "object" &&
    detail !== null &&
    (detail as { code?: string }).code === "AGE_GATE"
  );
}

/** Whole years between a date-of-birth string and today. */
export function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}
