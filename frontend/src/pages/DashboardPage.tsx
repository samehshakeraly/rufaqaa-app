import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { PaymentsChart } from "@/components/PaymentsChart";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchPaymentsTimeseries, fetchSummary } from "@/lib/stats";

export function DashboardPage() {
  const { t } = useTranslation();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["stats", "summary"],
    queryFn: fetchSummary,
  });
  const { data: timeseries } = useQuery({
    queryKey: ["stats", "payments-timeseries"],
    queryFn: fetchPaymentsTimeseries,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("dashboard.title")}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("dashboard.orphansTotal")} value={summary?.orphans_total} />
        <Stat
          label={t("dashboard.orphansSponsored")}
          value={summary?.orphans_sponsored}
          accent="emerald"
        />
        <Stat
          label={t("dashboard.orphansAvailable")}
          value={summary?.orphans_available}
        />
        <Stat label={t("dashboard.donorsTotal")} value={summary?.donors_total} />
        <Stat
          label={t("dashboard.sponsorshipsActive")}
          value={summary?.sponsorships_active}
          accent="emerald"
        />
        <Stat
          label={t("dashboard.sponsorshipsOverdue")}
          value={summary?.sponsorships_overdue}
          accent={summary && summary.sponsorships_overdue > 0 ? "amber" : undefined}
        />
        <Stat
          label={t("dashboard.payments30d")}
          value={
            summary
              ? `${summary.payments_last_30d_total} (${summary.payments_last_30d_count})`
              : undefined
          }
        />
      </div>

      {timeseries && (
        <div className="card">
          <h2 className="mb-3 text-lg font-semibold">
            {t("dashboard.paymentsChart")}
          </h2>
          <PaymentsChart data={timeseries} />
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("dashboard.accountInfo")}</h2>
        {(meLoading || summaryLoading) && (
          <p className="text-slate-500">{t("common.loading")}</p>
        )}
        {me && (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">{t("dashboard.name")}</dt>
              <dd className="font-medium text-slate-900">
                {me.first_name} {me.last_name}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("dashboard.email")}</dt>
              <dd className="font-medium text-slate-900">{me.email}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("dashboard.role")}</dt>
              <dd className="font-medium text-slate-900">{me.role}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("dashboard.organization")}</dt>
              <dd className="font-mono text-xs text-slate-600">{me.organization_id}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string | undefined;
  accent?: "emerald" | "amber";
}) {
  const valueColor =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueColor}`}>
        {value === undefined ? "—" : value.toLocaleString?.() ?? value}
      </p>
    </div>
  );
}
