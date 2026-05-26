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
