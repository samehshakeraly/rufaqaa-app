import type { components } from "@/api/schema.gen";

import { api } from "./api";
import type { Page } from "./orphans";

/** DONOR-SAFE projection of a published report. Generated from the
 * backend OpenAPI schema — carries only the sections a supervisor chose
 * to show (hidden ones arrive as `null`), plus the donor-facing
 * `summary`, `donor_message`, milestone flags, and provenance dates.
 * Reuse this directly; never redefine the section shapes. */
export type ReportDonorRead = components["schemas"]["ReportDonorRead"];

export type ReportStatus =
  | "draft"
  | "pending_partner_approval"
  | "partner_approved"
  | "pending_org_approval"
  | "org_approved"
  | "published_to_donor"
  | "rejected";

export interface Report {
  id: string;
  orphan_id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  summary: string | null;
  educational_progress: Record<string, unknown> | null;
  quran_progress: Record<string, unknown> | null;
  activities: Record<string, unknown> | null;
  health_status: Record<string, unknown> | null;
  psychological_status: Record<string, unknown> | null;
  status: ReportStatus;
  created_at: string;
  updated_at: string;
}

export type ReportAction =
  | "submit"
  | "approve-partner"
  | "approve-org"
  | "publish"
  | "reject";

export async function listReports(params?: {
  limit?: number;
  offset?: number;
  orphan_id?: string;
  status?: string;
}): Promise<Page<Report>> {
  const { data } = await api.get<Page<Report>>("/reports", { params });
  return data;
}

/** Donor self-service: reports for every orphan the calling donor
 * sponsors. The backend returns only reports already published to
 * donors (`status='published_to_donor'`) and scopes them to the
 * donor's own sponsored orphans. */
export async function listMyReports(params?: {
  limit?: number;
  offset?: number;
}): Promise<Page<ReportDonorRead>> {
  const { data } = await api.get<Page<ReportDonorRead>>("/me/reports", {
    params,
  });
  return data;
}

export async function transitionReport(
  id: string,
  action: ReportAction,
  reason?: string,
): Promise<Report> {
  const body = action === "reject" ? { reason } : {};
  const { data } = await api.post<Report>(`/reports/${id}/${action}`, body);
  return data;
}

export async function getReport(id: string): Promise<Report> {
  const { data } = await api.get<Report>(`/reports/${id}`);
  return data;
}

export interface ReportUpdateInput {
  summary?: string;
  educational_progress?: Record<string, unknown>;
  quran_progress?: Record<string, unknown>;
  activities?: Record<string, unknown>;
  health_status?: Record<string, unknown>;
  psychological_status?: Record<string, unknown>;
}

export async function updateReport(
  id: string,
  payload: ReportUpdateInput,
): Promise<Report> {
  const { data } = await api.patch<Report>(`/reports/${id}`, payload);
  return data;
}
