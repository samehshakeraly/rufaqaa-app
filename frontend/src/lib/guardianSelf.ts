import type { components } from "@/api/schema.gen";

import { api } from "./api";
import type { DocumentRead, DocumentType } from "./documents";
import type { OrphanCreateInput } from "./orphans";

/**
 * Guardian self-service API client.
 *
 * Mirrors `orphanSelf.ts` — every type here is the privacy-safe projection
 * the backend returns (see backend/app/api/v1/guardian_self.py). This portal
 * shows a child's profile and reports, so the wire shapes deliberately omit
 * donor identity/contact and financial figures.
 *
 * Financials are HIDDEN by default: the per-org flag
 * `business_rules.show_financial_to_guardian` (default FALSE) decides whether
 * the backend attaches the optional `financials` sub-object on each orphan.
 * The client mirrors this — never render money/balance/sponsorship unless the
 * API actually returns `financials`.
 */

/** Thin family preview attached to the guardian profile — code + name only,
 * no street address or income. */
export interface GuardianFamilyMini {
  id: string;
  code: string;
  family_name: string | null;
  country_code: string | null;
  governorate: string | null;
}

/** GET /guardian/me — the calling guardian's own profile. */
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

/** Only attached when `business_rules.show_financial_to_guardian` is TRUE for
 * the guardian's org. Absent (financials === null) is the default. */
export interface GuardianOrphanFinancials {
  current_balance: string | null;
  balance_currency: string | null;
  is_sponsored: boolean;
}

/** GET /guardian/me/orphans — guardian-safe projection of an orphan. No donor
 * identity, no partner organisation. `financials` is only present when the org
 * opted in. */
export interface GuardianOrphan {
  id: string;
  code: string;
  first_name: string;
  family_name: string;
  date_of_birth: string;
  gender: string;
  case_status: string;
  profile_completion_percentage: number;
  financials?: GuardianOrphanFinancials | null;
}

export type ReportStatus =
  | "draft"
  | "pending_partner_approval"
  | "partner_approved"
  | "pending_org_approval"
  | "org_approved"
  | "published_to_donor"
  | "rejected";

export type ReportType =
  | "monthly"
  | "quarterly"
  | "annual"
  | "special"
  | "incident";

/** GET /guardian/me/reports — full ReportRead for one of the guardian's
 * orphans. Carries no donor/financial fields. */
export interface GuardianReport {
  id: string;
  organization_id: string;
  orphan_id: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  summary: string | null;
  status: ReportStatus;
  submitted_at: string | null;
  partner_approved_at: string | null;
  org_approved_at: string | null;
  published_at: string | null;
  rejection_reason: string | null;
  photos_count: number;
  videos_count: number;
  documents_count: number;
  created_at: string;
  updated_at: string;
}

export async function getGuardianMe(): Promise<GuardianProfile> {
  const { data } = await api.get<GuardianProfile>("/guardian/me");
  return data;
}

export async function listGuardianOrphans(): Promise<GuardianOrphan[]> {
  const { data } = await api.get<GuardianOrphan[]>("/guardian/me/orphans");
  return data;
}

/** POST /guardian/me/orphans — a guardian registers a new orphan (G-06).
 *
 * The orphan lands in `case_status='pending_review'`, exactly like a
 * staff-created record, and surfaces in the same supervisor approval queue.
 * The partner organisation, family and org are derived server-side from the
 * guardian — the API rejects them in the body — so we send only the core
 * identity fields (`father_name` is required). The backend 409s on the
 * canonical no-duplicate rule. */
export async function createMyOrphan(payload: OrphanCreateInput): Promise<GuardianOrphan> {
  const body = {
    first_name: payload.first_name,
    family_name: payload.family_name,
    date_of_birth: payload.date_of_birth,
    gender: payload.gender,
    father_name: payload.father_name,
    ...(payload.nationality ? { nationality: payload.nationality } : {}),
    ...(payload.middle_name ? { middle_name: payload.middle_name } : {}),
    ...(payload.full_name_en ? { full_name_en: payload.full_name_en } : {}),
    ...(payload.father_death_date ? { father_death_date: payload.father_death_date } : {}),
  };
  const { data } = await api.post<GuardianOrphan>("/guardian/me/orphans", body);
  return data;
}

/** Reports for one of the guardian's orphans. `orphanId` is required by the
 * backend (it 403s if the orphan isn't in the guardian's family). */
export async function listGuardianReports(
  orphanId: string,
  limit = 20,
): Promise<GuardianReport[]> {
  const { data } = await api.get<GuardianReport[]>("/guardian/me/reports", {
    params: { orphan_id: orphanId, limit },
  });
  return data;
}

/** Body for POST /guardian/me/reports. Text-only for this cut (G-04): the
 * wizard maps mood → `psychological_status` and the star rating + notes →
 * `educational_progress`. Photo/voice attachments are deferred. */
export interface GuardianReportInput {
  orphan_id: string;
  report_type?: ReportType;
  period_start: string;
  period_end: string;
  summary?: string;
  educational_progress?: Record<string, unknown>;
  psychological_status?: Record<string, unknown>;
  quran_progress?: Record<string, unknown>;
  activities?: Record<string, unknown>;
  health_status?: Record<string, unknown>;
}

/** POST /guardian/me/reports — creates a report that lands directly in
 * `pending_partner_approval`, so it surfaces in the staff review queue and the
 * guardian sees the pending→approved/rejected status on the orphan page. The
 * backend 403s if the orphan isn't in the guardian's family. */
export async function createGuardianReport(
  body: GuardianReportInput,
): Promise<GuardianReport> {
  const { data } = await api.post<GuardianReport>("/guardian/me/reports", body);
  return data;
}

/** GET /guardian/me/orphans/{id}/documents — the orphan's documents with their
 * `verification_status` (pending → verified/rejected) for the G-03 UI. 403 if
 * the orphan isn't in the guardian's family. */
export async function listGuardianOrphanDocuments(
  orphanId: string,
): Promise<DocumentRead[]> {
  const { data } = await api.get<DocumentRead[]>(
    `/guardian/me/orphans/${orphanId}/documents`,
  );
  return data;
}

/** POST /guardian/me/orphans/{id}/documents — single multipart call: stages the
 * file and registers it as `verification_status='pending'`, so it rides the
 * existing staff document-verification workflow. Never auto-verified. */
export async function uploadGuardianOrphanDocument(
  orphanId: string,
  file: File,
  documentType: DocumentType,
  title?: string,
): Promise<DocumentRead> {
  const form = new FormData();
  form.append("file", file);
  form.append("document_type", documentType);
  if (title) form.append("title", title);
  const { data } = await api.post<DocumentRead>(
    `/guardian/me/orphans/${orphanId}/documents`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

// ── Photos — types track schema.gen.ts ────────────────────────────────────
/** One of the orphan's photos: a presigned URL + its moderation_status. */
export type GuardianOrphanPhoto = components["schemas"]["GuardianOrphanPhoto"];
/** Acknowledgement of a guardian photo upload (always lands 'pending'). */
export type GuardianPhotoUploadResult = components["schemas"]["GuardianPhotoUploadResult"];

/** GET /guardian/me/orphans/{id}/photos — the orphan's photos (every
 * moderation status) with a fresh presigned URL, newest first, so the portal
 * can show pending → approved/rejected. 403 if the orphan isn't in the
 * guardian's family. */
export async function listGuardianOrphanPhotos(
  orphanId: string,
): Promise<GuardianOrphanPhoto[]> {
  const { data } = await api.get<GuardianOrphanPhoto[]>(
    `/guardian/me/orphans/${orphanId}/photos`,
  );
  return data;
}

/** POST /guardian/me/orphans/{id}/photos — single multipart call: stages the
 * image and records it as moderation_status='pending' / visibility='private',
 * so it joins the same staff moderation queue as staff uploads. Never
 * auto-approved — nobody else sees it until a moderator approves it. */
export async function uploadGuardianOrphanPhoto(
  orphanId: string,
  file: File,
): Promise<GuardianPhotoUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<GuardianPhotoUploadResult>(
    `/guardian/me/orphans/${orphanId}/photos`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}
