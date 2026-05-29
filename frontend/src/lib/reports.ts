import { api } from "./api";
import type { Page } from "./orphans";

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
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export type ReportType =
  | "monthly"
  | "quarterly"
  | "annual"
  | "special"
  | "incident";

export interface ReportCreateInput {
  orphan_id: string;
  report_type: ReportType;
  period_start: string;
  period_end: string;
  summary?: string;
  educational_progress?: Record<string, unknown>;
  quran_progress?: Record<string, unknown>;
  activities?: Record<string, unknown>;
  health_status?: Record<string, unknown>;
  psychological_status?: Record<string, unknown>;
}

export async function createReport(payload: ReportCreateInput): Promise<Report> {
  const { data } = await api.post<Report>("/reports", payload);
  return data;
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
