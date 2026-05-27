import { api } from "./api";
import type { TokenPair } from "./auth";

export interface DonorSignupInput {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  country_code?: string;
  preferred_currency?: string;
  preferred_language?: "ar" | "en";
}

export interface DonorSignupResponse {
  detail: string;
  debug_verify_token: string | null;
}

export async function donorSignup(
  payload: DonorSignupInput,
): Promise<DonorSignupResponse> {
  const { data } = await api.post<DonorSignupResponse>("/auth/signup", payload);
  return data;
}

export async function verifyEmail(token: string): Promise<TokenPair> {
  const { data } = await api.post<TokenPair>("/auth/verify-email", { token });
  return data;
}

export async function resendVerification(
  email: string,
): Promise<DonorSignupResponse> {
  const { data } = await api.post<DonorSignupResponse>(
    "/auth/resend-verification",
    { email },
  );
  return data;
}

// Donor self-service ---------------------------------------------------------

export interface DonorProfile {
  id: string;
  code: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  country_of_residence: string | null;
  preferred_currency: string | null;
  status: string;
  total_sponsorships: number;
  active_sponsorships: number;
  total_donated: string;
}

export interface DonorSponsorshipMini {
  id: string;
  code: string;
  monthly_amount: string;
  currency: string;
  status: string;
  start_date: string | null;
  total_paid: string;
  orphan_code: string | null;
  orphan_first_name: string | null;
}

export interface DonorPaymentMini {
  id: string;
  code: string;
  amount: string;
  currency: string;
  status: string;
  payment_method: string;
  completed_at: string | null;
  created_at: string;
}

export async function getDonorMe(): Promise<DonorProfile> {
  const { data } = await api.get<DonorProfile>("/donor/me");
  return data;
}

export async function patchDonorMe(
  patch: Partial<Pick<DonorProfile, "full_name" | "phone" | "country_of_residence" | "preferred_currency">>,
): Promise<DonorProfile> {
  const { data } = await api.patch<DonorProfile>("/donor/me", patch);
  return data;
}

export async function listMyDonorSponsorships(): Promise<DonorSponsorshipMini[]> {
  const { data } = await api.get<DonorSponsorshipMini[]>(
    "/donor/me/sponsorships",
  );
  return data;
}

export async function listMyDonorPayments(): Promise<DonorPaymentMini[]> {
  const { data } = await api.get<DonorPaymentMini[]>("/donor/me/payments");
  return data;
}

export async function createMyDonorSponsorship(payload: {
  orphan_code: string;
  monthly_amount: string;
  currency: string;
  frequency?: "monthly" | "quarterly" | "semi_annual" | "annual" | "one_time";
}): Promise<DonorSponsorshipMini> {
  const { data } = await api.post<DonorSponsorshipMini>(
    "/donor/me/sponsorships",
    payload,
  );
  return data;
}
