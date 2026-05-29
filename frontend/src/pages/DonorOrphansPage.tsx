import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { listMySponsorships } from "@/lib/sponsorships";

const ACTIVE_STATUSES = new Set(["active", "paused", "overdue"]);

/** D-06 — cards for every orphan the donor currently sponsors.
 *
 * Derived from GET /me/sponsorships, filtered to the live statuses
 * (active / paused / overdue). Each card links to the sponsored-orphan
 * detail (D-07), keyed by orphan_id. */
export function DonorOrphansPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["donor", "me", "portal-sponsorships"],
    queryFn: () => listMySponsorships({ limit: 100 }),
  });

  const orphans = (q.data?.items ?? []).filter(
    (s) => ACTIVE_STATUSES.has(s.status) && s.orphan_id,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("donor.orphans.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("donor.orphans.subtitle")}
        </p>
      </header>

      {q.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      )}

      {q.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
        >
          {t("common.loadError")}
        </p>
      )}

      {q.data && orphans.length === 0 && (
        <div className="card text-center text-gray-500 dark:text-gray-400">
          <p>{t("donor.orphans.empty")}</p>
          <Link to="/orphans" className="btn-primary mt-3 inline-block">
            {t("donor.orphans.browse")}
          </Link>
        </div>
      )}

      {orphans.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orphans.map((s) => (
            <li key={s.id}>
              <Link
                to={`/donor/orphans/${s.orphan_id}`}
                className="card flex h-full flex-col gap-3 transition hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-tranquil-200 text-trust-600 dark:bg-gray-700"
                  >
                    {/* Placeholder avatar — never real-child imagery. */}
                    <svg
                      viewBox="0 0 24 24"
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5 19a7 7 0 0 1 14 0" strokeLinecap="round" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900 dark:text-gray-100">
                      {s.orphan_name ?? "—"}
                    </p>
                    {s.orphan_code && (
                      <p className="font-mono text-xs text-gray-500">
                        {s.orphan_code}
                      </p>
                    )}
                  </div>
                </div>

                <dl className="mt-auto space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">
                      {t("donor.orphans.monthlyAmount")}
                    </dt>
                    <dd className="font-medium tabular-nums text-gray-900 dark:text-gray-100">
                      {s.monthly_amount} {s.currency}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-gray-500">
                      {t("donor.sponsorships.status")}
                    </dt>
                    <dd>
                      <StatusBadge status={s.status} />
                    </dd>
                  </div>
                </dl>

                <span className="text-sm font-medium text-trust-600">
                  {t("donor.orphans.viewDetail")} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === "active"
      ? "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-100"
      : status === "overdue"
        ? "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100"
        : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {t(`sponsorships.statuses.${status}`, status)}
    </span>
  );
}
