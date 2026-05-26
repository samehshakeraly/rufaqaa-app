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

export interface MonthlyPoint {
  month: string; // YYYY-MM-DD (1st of month)
  payments_total: string;
  payments_count: number;
}

export interface PaymentsTimeseries {
  months: MonthlyPoint[];
}

export async function fetchPaymentsTimeseries(): Promise<PaymentsTimeseries> {
  const { data } = await api.get<PaymentsTimeseries>("/stats/payments-timeseries");
  return data;
}

export interface StatusSlice {
  status: string;
  count: number;
}

export interface SponsorshipsByStatus {
  slices: StatusSlice[];
}

export async function fetchSponsorshipsByStatus(): Promise<SponsorshipsByStatus> {
  const { data } = await api.get<SponsorshipsByStatus>(
    "/stats/sponsorships-by-status",
  );
  return data;
}

export interface PartnerDonations {
  partner_id: string;
  partner_code: string;
  partner_name: string;
  payments_total: string;
  payments_count: number;
}

export interface DonationsByPartner {
  window_days: number;
  items: PartnerDonations[];
}

export async function fetchDonationsByPartner(): Promise<DonationsByPartner> {
  const { data } = await api.get<DonationsByPartner>("/stats/donations-by-partner");
  return data;
}
