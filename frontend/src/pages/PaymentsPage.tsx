import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Pagination } from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import { exportPaymentsCsv, listPayments } from "@/lib/payments";
import { toast } from "@/store/toasts";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  "",
  "pending",
  "processing",
  "completed",
  "failed",
  "refunded",
] as const;

export function PaymentsPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Reset to first page whenever the filter changes.
  useEffect(() => {
    setOffset(0);
  }, [statusFilter]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", { limit: PAGE_SIZE, offset, statusFilter }],
    queryFn: () =>
      listPayments({
        limit: PAGE_SIZE,
        offset,
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("payments.title")}</h1>
        <div className="flex items-center gap-4">
          <select
            className="input max-w-[10rem]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? t("payments.allStatuses") : t(`payments.statuses.${s}`, s)}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil"
            onClick={async () => {
              try {
                const blob = await exportPaymentsCsv(
                  statusFilter ? { status: statusFilter } : {},
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "rufaqaa-payments.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error(t("common.loadError"));
              }
            }}
          >
            {t("payments.exportCsv")}
          </button>
        </div>
      </div>

      {data && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
        />
      )}

      {isLoading && <TableSkeleton columns={6} />}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-slate-500">{t("common.empty")}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">{t("payments.code")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.amount")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.method")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.gateway")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.status")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.completedAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((p) => (
                <tr key={p.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3">
                    {p.amount} {p.currency}
                  </td>
                  <td className="px-4 py-3">
                    {t(`payments.methods.${p.payment_method}`, p.payment_method)}
                  </td>
                  <td className="px-4 py-3">{p.payment_gateway ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t(`payments.statuses.${p.status}`, p.status)}
                  </td>
                  <td className="px-4 py-3">
                    {p.completed_at ? p.completed_at.slice(0, 10) : "—"}
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
