import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { OrgDonationsBar } from "@/components/OrgDonationsBar";
import { PaymentsChart } from "@/components/PaymentsChart";
import { Skeleton } from "@/components/Skeleton";
import { listPlatformOrganizations } from "@/lib/platform";
import {
  fetchPlatformByOrg,
  fetchPlatformTimeseries,
  type PaymentsTimeseries,
} from "@/lib/stats";
import { toast } from "@/store/toasts";

const RANGES = [3, 6, 12] as const;
type Range = (typeof RANGES)[number];

export function PlatformAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<Range>(12);

  const { data: timeseries } = useQuery({
    queryKey: ["platform", "timeseries"],
    queryFn: fetchPlatformTimeseries,
  });
  const { data: byOrg } = useQuery({
    queryKey: ["platform", "by-org", 10],
    queryFn: () => fetchPlatformByOrg(10),
  });
  const { data: orgs } = useQuery({
    queryKey: ["platform", "organizations", {}],
    queryFn: () => listPlatformOrganizations(),
  });

  // The backend timeseries is a fixed 12-month window; the range selector
  // trims it client-side so the super_admin can zoom into recent months.
  const ranged: PaymentsTimeseries | undefined = useMemo(() => {
    if (!timeseries) return undefined;
    return { months: timeseries.months.slice(-range) };
  }, [timeseries, range]);

  // Orgs grouped by country — derived from the org list (no dedicated
  // endpoint), so analytics stays read-only against existing routes.
  const byCountry = useMemo(() => {
    if (!orgs) return [];
    const counts = new Map<string, number>();
    for (const o of orgs) {
      counts.set(o.country_code, (counts.get(o.country_code) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [orgs]);

  const nfmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const maxCountry = Math.max(...byCountry.map(([, c]) => c), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t("platform.analytics.title")}
        </h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-600 dark:text-slate-300">
              {t("platform.analytics.range")}
            </span>
            <select
              className="input max-w-[10rem]"
              value={range}
              onChange={(e) => setRange(Number(e.target.value) as Range)}
            >
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  {t("platform.analytics.lastMonths", { count: r })}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil dark:border-gray-600 dark:text-slate-200 dark:hover:bg-gray-700"
            onClick={() => toast.info(t("common.comingSoon"))}
          >
            {t("platform.analytics.exportCsv")}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">
          {t("platform.analytics.paymentsByMonth")}
        </h2>
        {ranged ? <PaymentsChart data={ranged} /> : <Skeleton className="h-32 w-full" />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-lg font-semibold">
            {t("platform.analytics.topOrgs")}
          </h2>
          {byOrg ? <OrgDonationsBar data={byOrg} /> : <Skeleton className="h-32 w-full" />}
        </div>

        <div className="card">
          <h2 className="mb-3 text-lg font-semibold">
            {t("platform.analytics.orgsByCountry")}
          </h2>
          {!orgs && <Skeleton className="h-32 w-full" />}
          {orgs && byCountry.length === 0 && (
            <p className="text-sm text-slate-500">{t("common.empty")}</p>
          )}
          {orgs && byCountry.length > 0 && (
            <ul className="space-y-2">
              {byCountry.map(([country, count]) => (
                <li key={country} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{country}</span>
                    <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {nfmt.format(count)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-snow dark:bg-gray-700">
                    <div
                      className="h-full bg-trust"
                      style={{ inlineSize: `${((count / maxCountry) * 100).toFixed(1)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
