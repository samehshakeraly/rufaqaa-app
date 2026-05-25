import { api } from "./api";

export interface DashboardSummary {
  orphans_total: number;
  orphans_sponsored: number;
  orphans_available: number;
  donors_total: number;
  sponsorships_active: number;
  sponsorships_overdue: number;
  payments_last_30d_total: string;
  payments_last_30d_count: number;
}

export async function fetchSummary(): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>("/stats/summary");
  return data;
}
