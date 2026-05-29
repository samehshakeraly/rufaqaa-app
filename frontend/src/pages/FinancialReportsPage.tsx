import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Skeleton } from "@/components/Skeleton";
import { fetchOrganization } from "@/lib/organization";
import { exportPaymentsCsv } from "@/lib/payments";
import {
  fetchDonationsByPartner,
  fetchPaymentsTimeseries,
  fetchSummary,
} from "@/lib/stats";
import { toast } from "@/store/toasts";

function firstOfMonthISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FinancialReportsPage() {
  const { t } = useTranslation();
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());

  const { data: org } = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
  });
  const { data: summary } = useQuery({
    queryKey: ["stats", "summary"],
    queryFn: fetchSummary,
  });
  const { data: timeseries } = useQuery({
    queryKey: ["stats", "payments-timeseries"],
    queryFn: fetchPaymentsTimeseries,
  });
  const { data: byPartner } = useQuery({
    queryKey: ["stats", "donations-by-partner"],
    queryFn: fetchDonationsByPartner,
  });

  const baseCurrency = org?.default_currency ?? null;

  // Range-accurate "total received": sum the monthly timeseries points
  // whose month falls inside the selected window. (Only the timeseries
  // endpoint is date-decomposable; the partner totals use a fixed
  // server window — see the footnotes.)
  const totalReceived = (timeseries?.months ?? [])
    .filter((m) => m.month >= from.slice(0, 7) + "-01" && m.month <= to)
    .reduce((sum, m) => sum + Number(m.payments_total), 0);

  const totalTransferred = (byPartner?.items ?? []).reduce(
    (sum, p) => sum + Number(p.payments_total),
    0,
  );
  const netRetained = totalReceived - totalTransferred;

  async function onExport() {
    try {
      const blob = await exportPaymentsCsv({ status: "completed" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rufaqaa-payments.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("common.loadError"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("finance.reports.title")}
        </h1>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            <span className="mb-1 block">{t("finance.reports.from")}</span>
            <input
              type="date"
              className="input max-w-[10rem]"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            <span className="mb-1 block">{t("finance.reports.to")}</span>
            <input
              type="date"
              className="input max-w-[10rem]"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="button" className="btn-primary" onClick={onExport}>
            {t("finance.reports.exportCsv")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={t("finance.reports.totalReceived")}
          hint={t("finance.reports.totalReceivedHint")}
          value={
            timeseries ? (
              <Money amount={totalReceived} currency={baseCurrency} />
            ) : undefined
          }
        />
        <SummaryCard
          label={t("finance.reports.totalTransferred")}
          hint={
            byPartner
              ? t("finance.reports.windowHint", { days: byPartner.window_days })
              : undefined
          }
          value={
            byPartner ? (
              <Money amount={totalTransferred} currency={baseCurrency} />
            ) : undefined
          }
        />
        <SummaryCard
          label={t("finance.reports.netRetained")}
          hint={t("finance.reports.netRetainedHint")}
          value={
            timeseries && byPartner ? (
              <Money amount={netRetained} currency={baseCurrency} />
            ) : undefined
          }
        />
        <SummaryCard
          label={t("finance.reports.donorCount")}
          value={summary ? summary.donors_total.toLocaleString() : undefined}
        />
      </div>

      <div className="card">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("finance.reports.byPartner")}
        </h2>
        {byPartner && (
          <p className="mb-4 text-xs text-gray-500">
            {t("finance.reports.windowHint", { days: byPartner.window_days })}
          </p>
        )}
        {!byPartner && <Skeleton className="h-32 w-full" />}
        {byPartner && byPartner.items.length === 0 && (
          <p className="text-sm text-gray-500">{t("common.empty")}</p>
        )}
        {byPartner && byPartner.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-start">
              <caption className="sr-only">{t("finance.reports.byPartner")}</caption>
              <thead className="border-b border-sky text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("finance.reports.partner")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("finance.reports.transactions")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium text-end">
                    {t("finance.reports.amount")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
                {byPartner.items.map((p) => (
                  <tr key={p.partner_id} className="hover:bg-snow dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3">
                      <span className="me-2 font-mono text-xs text-gray-500">
                        {p.partner_code}
                      </span>
                      {p.partner_name}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {p.payments_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Money amount={p.payments_total} currency={baseCurrency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">{t("finance.reports.exportNote")}</p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode | undefined;
  hint?: string;
}) {
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value === undefined ? <Skeleton className="h-7 w-24" /> : value}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
