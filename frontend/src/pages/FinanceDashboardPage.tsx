import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Money } from "@/components/Money";
import { Skeleton, StatGridSkeleton, TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { listBankTransfers } from "@/lib/bankTransfers";
import { fetchOrganization } from "@/lib/organization";
import { listPayments, type PaymentMethod } from "@/lib/payments";
import { fetchSummary } from "@/lib/stats";

// Design-system token ramp for the by-method bars — no random hex.
const METHOD_BAR_TOKENS = [
  "bg-trust-500",
  "bg-trust-400",
  "bg-trust-300",
  "bg-sky-400",
  "bg-tranquil-400",
  "bg-info-500",
  "bg-success-500",
  "bg-warning-500",
] as const;

export function FinanceDashboardPage() {
  const { t } = useTranslation();
  const { isAdmin } = useRole();

  const { data: summary } = useQuery({
    queryKey: ["stats", "summary"],
    queryFn: fetchSummary,
  });
  const { data: org } = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
  });
  const { data: pending } = useQuery({
    queryKey: ["payments", { status: "pending", count: true }],
    queryFn: () => listPayments({ status: "pending", limit: 1 }),
  });
  const { data: overdue } = useQuery({
    queryKey: ["payments", { donorOverdue: true, count: true }],
    queryFn: () => listPayments({ donor_overdue: true, limit: 1 }),
  });
  // Bank transfers are admin-only on the server; finance users simply
  // see "—" for this card rather than triggering a 403.
  const { data: transfers } = useQuery({
    queryKey: ["bank-transfers", { status: "completed", count: true }],
    queryFn: () => listBankTransfers({ status: "completed" }),
    enabled: isAdmin,
  });
  // One fetch powers both the recent-payments table (first 20) and the
  // by-method chart (aggregated over the page).
  const { data: completed, isLoading: completedLoading } = useQuery({
    queryKey: ["payments", { status: "completed", limit: 100 }],
    queryFn: () => listPayments({ status: "completed", limit: 100 }),
  });

  const baseCurrency = org?.default_currency ?? null;

  const byMethod = aggregateByMethod(completed?.items ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("finance.dashboard.title")}
        </h1>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/finance/overdue"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t("finance.dashboard.linkOverdue")}
          </Link>
          <Link to="/admin/finance/reports" className="btn-primary">
            {t("finance.dashboard.linkReports")}
          </Link>
        </div>
      </div>

      {!summary && <StatGridSkeleton cards={4} />}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t("finance.dashboard.received30d")}
            value={
              <Money
                amount={summary.payments_last_30d_total}
                currency={baseCurrency}
              />
            }
            hint={t("finance.dashboard.received30dCount", {
              n: summary.payments_last_30d_count,
            })}
          />
          <Stat
            label={t("finance.dashboard.pendingPayments")}
            value={pending ? pending.total.toLocaleString() : "—"}
          />
          <Stat
            label={t("finance.dashboard.overdueDonors")}
            value={overdue ? overdue.total.toLocaleString() : "—"}
            accent={overdue && overdue.total > 0 ? "warning" : undefined}
          />
          <Stat
            label={t("finance.dashboard.completedTransfers")}
            value={
              isAdmin
                ? transfers
                  ? transfers.total.toLocaleString()
                  : "—"
                : t("finance.dashboard.adminOnly")
            }
          />
        </div>
      )}

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("finance.dashboard.byMethod")}
        </h2>
        {!completed && <Skeleton className="h-32 w-full" />}
        {completed && byMethod.length === 0 && (
          <p className="text-sm text-gray-500">{t("common.empty")}</p>
        )}
        {completed && byMethod.length > 0 && (
          <ul className="space-y-3">
            {byMethod.map((m, i) => {
              const maxTotal = byMethod[0]?.total ?? 0;
              const pct = maxTotal > 0 ? (m.total / maxTotal) * 100 : 0;
              return (
                <li key={m.method} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-200">
                      {t(`payments.methods.${m.method}`, m.method)}
                    </span>
                    <Money
                      amount={m.total}
                      currency={baseCurrency}
                      className="font-medium text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-snow dark:bg-gray-700">
                    <div
                      className={`h-full rounded ${METHOD_BAR_TOKENS[i % METHOD_BAR_TOKENS.length]}`}
                      style={{ inlineSize: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-500">
          {t("finance.dashboard.byMethodNote")}
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("finance.dashboard.recentPayments")}
        </h2>
        {completedLoading && <TableSkeleton columns={5} />}
        {completed && completed.items.length === 0 && (
          <div className="card text-center text-gray-500">{t("common.empty")}</div>
        )}
        {completed && completed.items.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full text-start">
              <caption className="sr-only">
                {t("finance.dashboard.recentPayments")}
              </caption>
              <thead className="border-b border-sky bg-tranquil/40 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-200">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("payments.code")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("payments.amount")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("payments.method")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t("payments.completedAt")}
                  </th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
                {completed.items.slice(0, 20).map((p) => (
                  <tr key={p.id} className="hover:bg-snow dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3">
                      <Money amount={p.amount} currency={p.currency} />
                    </td>
                    <td className="px-4 py-3">
                      {t(`payments.methods.${p.payment_method}`, p.payment_method)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {p.completed_at ? p.completed_at.slice(0, 10) : "—"}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        to={`/admin/payments/${p.id}/receipt`}
                        className="text-xs text-trust underline"
                      >
                        {t("payments.viewReceipt")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function aggregateByMethod(
  items: { payment_method: PaymentMethod; amount: string }[],
): { method: PaymentMethod; total: number }[] {
  const map = new Map<PaymentMethod, number>();
  for (const p of items) {
    map.set(p.payment_method, (map.get(p.payment_method) ?? 0) + Number(p.amount));
  }
  return [...map.entries()]
    .map(([method, total]) => ({ method, total }))
    .sort((a, b) => b.total - a.total);
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "warning";
}) {
  const valueColor =
    accent === "warning"
      ? "text-warning-700"
      : "text-gray-900 dark:text-gray-100";
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueColor}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
