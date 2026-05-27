import { api } from "./api";
import type { Page } from "./orphans";

export type TransferStatus =
  | "pending"
  | "approved"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface BankTransfer {
  id: string;
  code: string;
  partner_organization_id: string;
  amount: string;
  currency: string;
  bank_name: string | null;
  bank_reference: string | null;
  period_start: string;
  period_end: string;
  status: TransferStatus;
  approved_at: string | null;
  executed_at: string | null;
  confirmed_by_partner_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface BankTransferCreateInput {
  partner_organization_id: string;
  amount: string;
  currency: string;
  period_start: string;
  period_end: string;
  bank_name?: string;
  bank_reference?: string;
  notes?: string;
}

export async function listBankTransfers(params?: {
  status?: string;
  partner_id?: string;
}): Promise<Page<BankTransfer>> {
  const { data } = await api.get<Page<BankTransfer>>("/bank-transfers", {
    params: { limit: 100, ...params },
  });
  return data;
}

export async function createBankTransfer(
  payload: BankTransferCreateInput,
): Promise<BankTransfer> {
  const { data } = await api.post<BankTransfer>("/bank-transfers", payload);
  return data;
}

async function transition(
  id: string,
  action: "approve" | "mark-completed" | "cancel",
): Promise<BankTransfer> {
  const { data } = await api.post<BankTransfer>(`/bank-transfers/${id}/${action}`);
  return data;
}

export const approveBankTransfer = (id: string) => transition(id, "approve");
export const markBankTransferCompleted = (id: string) =>
  transition(id, "mark-completed");
export const cancelBankTransfer = (id: string) => transition(id, "cancel");

export interface ConfirmReceiptInput {
  confirmation_document_id?: string;
  notes?: string;
}

export async function confirmBankTransferReceipt(
  id: string,
  body?: ConfirmReceiptInput,
): Promise<BankTransfer & { confirmation_document_id: string | null }> {
  const { data } = await api.post<
    BankTransfer & { confirmation_document_id: string | null }
  >(`/bank-transfers/${id}/confirm-receipt`, body ?? {});
  return data;
}
