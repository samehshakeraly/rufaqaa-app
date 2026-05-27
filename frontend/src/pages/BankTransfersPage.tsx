import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TableSkeleton } from "@/components/Skeleton";
import {
  approveBankTransfer,
  type BankTransferCreateInput,
  cancelBankTransfer,
  confirmBankTransferReceipt,
  createBankTransfer,
  listBankTransfers,
  markBankTransferCompleted,
  type TransferStatus,
} from "@/lib/bankTransfers";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

const QK = ["bank-transfers"] as const;

const STATUS_BADGE: Record<TransferStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  approved: "bg-amber-100 text-amber-800",
  processing: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500 line-through",
};

export function BankTransfersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const transfersQ = useQuery({
    queryKey: QK,
    queryFn: () => listBankTransfers(),
  });
  const partnersQ = useQuery({
    queryKey: ["partners", { includeInactive: false }],
    queryFn: () => listPartners(false),
  });

  function axiosMsg(err: unknown): string {
    if (err instanceof AxiosError)
      return err.response?.data?.detail ?? err.message;
    return (err as Error).message ?? "error";
  }

  const approveM = useMutation({
    mutationFn: (id: string) => approveBankTransfer(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.approved"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });
  const completeM = useMutation({
    mutationFn: (id: string) => markBankTransferCompleted(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.completed"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });
  const cancelM = useMutation({
    mutationFn: (id: string) => cancelBankTransfer(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.cancelled"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });
  const confirmM = useMutation({
    mutationFn: (id: string) => confirmBankTransferReceipt(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.confirmed"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });

  const partnerName = (id: string): string => {
    const p = partnersQ.data?.items.find((p) => p.id === id);
    if (!p) return id.slice(0, 8);
    return i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("bankTransfers.title")}
        </h1>
        <div className="flex items-center gap-4">
          {transfersQ.data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {transfersQ.data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("bankTransfers.addNew")}
          </button>
        </div>
      </div>

      {showForm && partnersQ.data && (
        <NewTransferForm
          partners={partnersQ.data.items}
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: QK });
            setShowForm(false);
          }}
        />
      )}

      {transfersQ.isLoading && <TableSkeleton columns={7} />}
      {transfersQ.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("common.loadError")}
        </p>
      )}

      {transfersQ.data && transfersQ.data.items.length === 0 && (
        <div className="card text-center text-slate-500">{t("common.empty")}</div>
      )}

      {transfersQ.data && transfersQ.data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">{t("bankTransfers.code")}</th>
                <th className="px-4 py-3 font-medium">{t("bankTransfers.partner")}</th>
                <th className="px-4 py-3 font-medium">{t("bankTransfers.amount")}</th>
                <th className="px-4 py-3 font-medium">{t("bankTransfers.period")}</th>
                <th className="px-4 py-3 font-medium">{t("bankTransfers.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {transfersQ.data.items.map((tx) => (
                <tr key={tx.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{tx.code}</td>
                  <td className="px-4 py-3">{partnerName(tx.partner_organization_id)}</td>
                  <td className="px-4 py-3 font-medium">
                    {tx.amount} {tx.currency}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {tx.period_start} → {tx.period_end}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs ${
                        STATUS_BADGE[tx.status]
                      }`}
                    >
                      {t(`bankTransfers.statuses.${tx.status}`, tx.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex justify-end gap-1">
                      {tx.status === "pending" && (
                        <ActionBtn
                          label={t("bankTransfers.approve")}
                          onClick={() => approveM.mutate(tx.id)}
                          busy={approveM.isPending}
                        />
                      )}
                      {(tx.status === "approved" || tx.status === "processing") && (
                        <ActionBtn
                          label={t("bankTransfers.markCompleted")}
                          onClick={() => completeM.mutate(tx.id)}
                          busy={completeM.isPending}
                        />
                      )}
                      {tx.status === "completed" &&
                        !tx.confirmed_by_partner_at && (
                          <ActionBtn
                            label={t("bankTransfers.confirmReceipt")}
                            onClick={() => confirmM.mutate(tx.id)}
                            busy={confirmM.isPending}
                          />
                        )}
                      {["pending", "approved", "processing"].includes(tx.status) && (
                        <ActionBtn
                          label={t("bankTransfers.cancel")}
                          variant="danger"
                          onClick={() => cancelM.mutate(tx.id)}
                          busy={cancelM.isPending}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  busy,
  variant,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  variant?: "danger";
}) {
  const cls =
    variant === "danger"
      ? "rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
      : "rounded border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil";
  return (
    <button type="button" className={cls} onClick={onClick} disabled={busy}>
      {label}
    </button>
  );
}

function NewTransferForm({
  partners,
  onCreated,
}: {
  partners: { id: string; name_ar: string; name_en: string | null }[];
  onCreated: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState<BankTransferCreateInput>({
    partner_organization_id: partners[0]?.id ?? "",
    amount: "",
    currency: "KWD",
    period_start: "",
    period_end: "",
    bank_name: "",
    bank_reference: "",
    notes: "",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createBankTransfer(v),
    onSuccess: () => {
      setV({
        partner_organization_id: partners[0]?.id ?? "",
        amount: "",
        currency: "KWD",
        period_start: "",
        period_end: "",
        bank_name: "",
        bank_reference: "",
        notes: "",
      });
      onCreated();
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        if (!v.partner_organization_id || !v.amount || !v.period_start || !v.period_end) {
          return;
        }
        mut.mutate();
      }}
      className="card space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.partner")}
          </span>
          <select
            className="input"
            value={v.partner_organization_id}
            onChange={(e) => setV({ ...v, partner_organization_id: e.target.value })}
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.amount")}
          </span>
          <input
            className="input"
            inputMode="decimal"
            value={v.amount}
            onChange={(e) => setV({ ...v, amount: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.currency")}
          </span>
          <input
            className="input"
            maxLength={3}
            value={v.currency}
            onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.periodStart")}
          </span>
          <input
            type="date"
            className="input"
            value={v.period_start}
            onChange={(e) => setV({ ...v, period_start: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.periodEnd")}
          </span>
          <input
            type="date"
            className="input"
            value={v.period_end}
            onChange={(e) => setV({ ...v, period_end: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.bankName")}
          </span>
          <input
            className="input"
            value={v.bank_name ?? ""}
            onChange={(e) => setV({ ...v, bank_name: e.target.value })}
          />
        </label>
      </div>
      {serverError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}
      <button type="submit" className="btn-primary" disabled={mut.isPending}>
        {mut.isPending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}
