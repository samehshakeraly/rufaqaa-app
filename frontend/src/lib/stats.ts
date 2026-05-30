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

// ── Platform-level (super-admin, cross-org) stats ────────────────────

export interface CurrencyTotal {
  currency: string;
  total: string;
}

export interface PlatformSummary {
  total_orgs: number;
  active_orgs: number;
  total_orphans: number;
  total_donors: number;
  total_sponsorships: number;
  total_donated_converted: string;
  total_donated_by_currency: CurrencyTotal[];
}

export async function fetchPlatformSummary(): Promise<PlatformSummary> {
  const { data } = await api.get<PlatformSummary>("/stats/platform/summary");
  return data;
}

export async function fetchPlatformTimeseries(): Promise<PaymentsTimeseries> {
  // Same shape as the per-org payments timeseries: { months: [...] }.
  const { data } = await api.get<PaymentsTimeseries>("/stats/platform/timeseries");
  return data;
}

export interface OrgRanking {
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sponsorships_count: number;
  donations_total: string;
}

export interface PlatformByOrg {
  limit: number;
  items: OrgRanking[];
}

export async function fetchPlatformByOrg(limit = 10): Promise<PlatformByOrg> {
  const { data } = await api.get<PlatformByOrg>("/stats/platform/by-org", {
    params: { limit },
  });
  return data;
}
