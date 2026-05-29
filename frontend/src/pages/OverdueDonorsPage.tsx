import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { TableSkeleton } from "@/components/Skeleton";
import { listPayments } from "@/lib/payments";
import { listSponsorships } from "@/lib/sponsorships";
import { toast } from "@/store/toasts";

/**
 * Months a sponsorship is behind, derived from its `next_payment_date`
 * (the backend doesn't expose `months_overdue` on the read schema). A
 * row only reaches this screen when the server-side `is_overdue` filter
 * already flagged it, so the result is at least 1.
 */
function monthsOverdue(nextPaymentDate: string | null): number | null {
  if (!nextPaymentDate) return null;
  const due = new Date(nextPaymentDate);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const months =
    (now.getFullYear() - due.getFullYear()) * 12 + (now.getMonth() - due.getMonth());
  return Math.max(1, months);
}

export function OverdueDonorsPage() {
  const { t } = useTranslation();
  const [minMonths, setMinMonths] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sponsorships", { overdue: true, minMonths }],
    queryFn: () =>
      listSponsorships({ is_overdue: true, min_months_overdue: minMonths, limit: 100 }),
  });
  // Last payment per overdue donor — keyed by donor_id so each
  // sponsorship row can show its donor's most recent payment date.
  const { data: lastPayments } = useQuery({
    queryKey: ["payments", { donorOverdue: true, limit: 100 }],
    queryFn: () => listPayments({ donor_overdue: true, limit: 100 }),
  });

  const lastPaymentByDonor = new Map<string, string | null>();
  for (const p of lastPayments?.items ?? []) {
    if (!lastPaymentByDonor.has(p.donor_id)) {
      lastPaymentByDonor.set(p.donor_id, p.completed_at);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("finance.overdue.title")}
        </h1>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          {t("finance.overdue.minMonths")}
          <input
            type="number"
            min={1}
            className="input max-w-[6rem] tabular-nums"
            value={minMonths}
            onChange={(e) => setMinMonths(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </div>

      {isLoading && <TableSkeleton columns={6} />}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-gray-500">
          {t("finance.overdue.empty")}
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <caption className="sr-only">{t("finance.overdue.title")}</caption>
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-200">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("finance.overdue.donor")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("finance.overdue.orphan")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("finance.overdue.monthlyAmount")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("finance.overdue.monthsOverdue")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("finance.overdue.lastPayment")}
                </th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
              {data.items.map((s) => {
                const months = monthsOverdue(s.next_payment_date);
                const lastPayment = lastPaymentByDonor.get(s.donor_id);
                return (
                  <tr key={s.id} className="hover:bg-snow dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3">
                      <span className="block text-gray-900 dark:text-gray-100">
                        {s.donor_name ?? "—"}
                      </span>
                      <span className="font-mono text-xs text-gray-500">
                        {s.donor_code ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {s.orphan_code ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Money amount={s.monthly_amount} currency={s.currency} />
                    </td>
                    <td className="px-4 py-3">
                      <OverdueBadge months={months} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {lastPayment ? lastPayment.slice(0, 10) : "—"}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <button
                        type="button"
                        className="rounded-lg border border-sky px-2 py-1 text-xs text-gray-700 hover:bg-tranquil dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                        onClick={() => toast.info(t("common.comingSoon"))}
                      >
                        {t("finance.overdue.sendReminder")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OverdueBadge({ months }: { months: number | null }) {
  const { t } = useTranslation();
  if (months == null) {
    return <span className="text-gray-400">—</span>;
  }
  const danger = months >= 2;
  const cls = danger
    ? "bg-danger-100 text-danger-700"
    : "bg-warning-100 text-warning-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}
    >
      {t("finance.overdue.monthsBadge", { n: months })}
    </span>
  );
}
