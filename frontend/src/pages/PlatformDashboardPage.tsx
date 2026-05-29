import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { OrgDonationsBar } from "@/components/OrgDonationsBar";
import { OrgStatusBadge } from "@/components/OrgStatusBadge";
import { PaymentsChart } from "@/components/PaymentsChart";
import { Skeleton, StatGridSkeleton } from "@/components/Skeleton";
import { listPlatformOrganizations } from "@/lib/platform";
import {
  fetchPlatformByOrg,
  fetchPlatformSummary,
  fetchPlatformTimeseries,
} from "@/lib/stats";

export function PlatformDashboardPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  const { data: summary } = useQuery({
    queryKey: ["platform", "summary"],
    queryFn: fetchPlatformSummary,
  });
  const { data: timeseries } = useQuery({
    queryKey: ["platform", "timeseries"],
    queryFn: fetchPlatformTimeseries,
  });
  const { data: byOrg } = useQuery({
    queryKey: ["platform", "by-org", 8],
    queryFn: () => fetchPlatformByOrg(8),
  });
  const { data: recentOrgs } = useQuery({
    queryKey: ["platform", "organizations", "recent"],
    queryFn: () => listPlatformOrganizations(),
  });

  const nfmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t("platform.dashboard.title")}
        </h1>
        <Link to="/platform/organizations" className="btn-primary">
          {t("platform.dashboard.manageOrgs")}
        </Link>
      </div>

      {!summary && <StatGridSkeleton cards={6} />}

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={t("platform.summary.totalOrgs")} value={summary.total_orgs} />
          <Stat
            label={t("platform.summary.activeOrgs")}
            value={summary.active_orgs}
            accent="success"
          />
          <Stat label={t("platform.summary.totalOrphans")} value={summary.total_orphans} />
          <Stat label={t("platform.summary.totalDonors")} value={summary.total_donors} />
          <Stat
            label={t("platform.summary.totalSponsorships")}
            value={summary.total_sponsorships}
          />
          <div className="card">
            <p className="text-sm text-slate-500">
              {t("platform.summary.totalDonated")}
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {nfmt.format(Number(summary.total_donated_converted))}
            </p>
            {summary.total_donated_by_currency.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {summary.total_donated_by_currency.map((c) => (
                  <li key={c.currency} className="tabular-nums">
                    {nfmt.format(Number(c.total))}
                    <span className="ms-1">{c.currency}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-lg font-semibold">
            {t("platform.dashboard.paymentsChart")}
          </h2>
          {timeseries ? (
            <PaymentsChart data={timeseries} />
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </div>
        <div className="card">
          <h2 className="mb-3 text-lg font-semibold">
            {t("platform.dashboard.topOrgs")}
          </h2>
          {byOrg ? <OrgDonationsBar data={byOrg} /> : <Skeleton className="h-32 w-full" />}
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("platform.dashboard.recentOrgs")}
          </h2>
          <Link
            to="/platform/organizations"
            className="text-sm font-medium text-trust-600 hover:underline"
          >
            {t("platform.dashboard.viewAll")}
          </Link>
        </div>
        {!recentOrgs && <Skeleton className="h-24 w-full" />}
        {recentOrgs && recentOrgs.length === 0 && (
          <p className="text-sm text-slate-500">{t("common.empty")}</p>
        )}
        {recentOrgs && recentOrgs.length > 0 && (
          <ul className="divide-y divide-sky/40 dark:divide-gray-700">
            {recentOrgs.slice(0, 6).map((org) => (
              <li
                key={org.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{org.code}</span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {isAr ? org.name_ar : org.name_en}
                  </span>
                  <OrgStatusBadge status={org.status} />
                </div>
                <span className="text-xs tabular-nums text-slate-500">
                  {new Date(org.created_at).toLocaleDateString(i18n.language)}
                </span>
              </li>
            ))}
          </ul>
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
  value: number | undefined;
  accent?: "success";
}) {
  const { i18n } = useTranslation();
  const valueColor = accent === "success" ? "text-success-700" : "text-slate-900 dark:text-slate-100";
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>
        {value === undefined ? "—" : value.toLocaleString(i18n.language)}
      </p>
    </div>
  );
}
