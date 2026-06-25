import type { components } from "@/api/schema.gen";

import { api } from "./api";
import type { Page } from "./orphans";

/** DONOR-SAFE projection of a payment. Generated from the backend OpenAPI
 * schema — carries only the fields a sponsor can see. */
export type PaymentDonorRead = components["schemas"]["PaymentDonorRead"];

export type PaymentMethod =
  | "credit_card"
  | "debit_card"
  | "bank_transfer"
  | "knet"
  | "paypal"
  | "cash"
  | "cheque"
  | "standing_order"
  | "mobile_payment"
  | "other";

// Full, ordered set of payment methods — used to populate filter dropdowns
// (the loaded page can't be the source once filtering is server-side).
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "credit_card",
  "debit_card",
  "bank_transfer",
  "knet",
  "paypal",
  "cash",
  "cheque",
  "standing_order",
  "mobile_payment",
  "other",
];

// Derived server-side from sponsorship link: "kafala" (tied to a sponsorship)
// vs "general" (everything else). No payment-level type column exists.
export type PaymentType = "kafala" | "general";

export interface Payment {
  id: string;
  code: string;
  donor_id: string;
  sponsorship_id: string | null;
  orphan_id: string | null;
  amount: string;
  currency: string;
  payment_method: PaymentMethod;
  payment_gateway: string | null;
  status: string;
  initiated_at: string;
  completed_at: string | null;
  created_at: string;
  // List-payload enrichment (see GET /payments). Codes only — never names:
  // orphan_code is the orphan's code; donor_reference is the donor's
  // non-identifying code. payment_type is the derived kafala/general value.
  orphan_code: string | null;
  donor_reference: string | null;
  payment_type: PaymentType;
}

export interface PaymentCreateInput {
  donor_id: string;
  sponsorship_id?: string;
  orphan_id?: string;
  amount: string;
  currency: string;
  payment_method: PaymentMethod;
  notes?: string;
}

export async function listPayments(params?: {
  limit?: number;
  offset?: number;
  donor_id?: string;
  sponsorship_id?: string;
  status?: string;
  /** Return one row per donor with an active, overdue sponsorship —
   * that donor's most recent payment. Used by the Overdue Donors screen
   * to surface each donor's last payment date. */
  donor_overdue?: boolean;
  /** Bound the effective payment time (completed_at ?? initiated_at), ISO 8601. */
  date_from?: string;
  date_to?: string;
  method?: PaymentMethod;
  currency?: string;
  payment_type?: PaymentType;
}): Promise<Page<Payment>> {
  const { data } = await api.get<Page<Payment>>("/payments", { params });
  return data;
}

export async function createPayment(payload: PaymentCreateInput): Promise<Payment> {
  const { data } = await api.post<Payment>("/payments", payload);
  return data;
}

export async function exportPaymentsCsv(params?: {
  donor_id?: string;
  sponsorship_id?: string;
  status?: string;
}): Promise<Blob> {
  const r = await api.get("/payments/export.csv", {
    params,
    responseType: "blob",
  });
  return r.data as Blob;
}

export interface PaymentReceipt {
  payment_id: string;
  payment_code: string;
  amount: string;
  currency: string;
  payment_method: PaymentMethod;
  status: string;
  completed_at: string | null;
  initiated_at: string;
  donor_id: string;
  donor_code: string;
  donor_name: string;
  donor_email: string | null;
  sponsorship_id: string | null;
  sponsorship_code: string | null;
  orphan_id: string | null;
  orphan_code: string | null;
  orphan_name: string | null;
  organization_id: string;
  organization_name_ar: string;
  organization_name_en: string | null;
}

export async function fetchPaymentReceipt(paymentId: string): Promise<PaymentReceipt> {
  const { data } = await api.get<PaymentReceipt>(`/payments/${paymentId}/receipt`);
  return data;
}

export interface PaymentInitiateInput {
  donor_id: string;
  sponsorship_id?: string;
  orphan_id?: string;
  amount: string;
  currency: string;
  language?: "ar" | "en";
}

export interface PaymentInitiateResponse {
  payment_id: string;
  invoice_id: string;
  payment_url: string;
}

export async function initiatePayment(
  payload: PaymentInitiateInput,
): Promise<PaymentInitiateResponse> {
  const { data } = await api.post<PaymentInitiateResponse>(
    "/payments/initiate",
    payload,
  );
  return data;
}

export interface AdminInitiateOnBehalfInput {
  donor_id: string;
  sponsorship_id?: string;
  orphan_id?: string;
  amount: string;
  currency: string;
  language?: "ar" | "en";
}

export async function adminInitiateOnBehalf(
  payload: AdminInitiateOnBehalfInput,
): Promise<PaymentInitiateResponse> {
  const { data } = await api.post<PaymentInitiateResponse>(
    "/payments/admin/initiate-on-behalf",
    payload,
  );
  return data;
}

export async function refundPayment(
  paymentId: string,
  amount: string,
  reason: string,
): Promise<Payment> {
  const { data } = await api.post<Payment>(`/payments/${paymentId}/refund`, {
    amount,
    reason,
  });
  return data;
}

/** Donor self-service: every payment the calling donor made, optionally
 * narrowed to one sponsored child. The backend scopes all results to the
 * calling donor — no cross-donor leakage is possible. */
export async function listMyPayments(params?: {
  orphanId?: string;
  limit?: number;
  offset?: number;
}): Promise<Page<PaymentDonorRead>> {
  const { data } = await api.get<Page<PaymentDonorRead>>("/me/payments", {
    params: { orphan_id: params?.orphanId, limit: params?.limit, offset: params?.offset },
  });
  return data;
}
