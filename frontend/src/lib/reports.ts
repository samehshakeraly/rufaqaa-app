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

export async function transitionReport(
  id: string,
  action: ReportAction,
  reason?: string,
): Promise<Report> {
  const body = action === "reject" ? { reason } : {};
  const { data } = await api.post<Report>(`/reports/${id}/${action}`, body);
  return data;
}
