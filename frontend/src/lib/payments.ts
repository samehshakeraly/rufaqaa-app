import { api } from "./api";
import type { Page } from "./orphans";

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
