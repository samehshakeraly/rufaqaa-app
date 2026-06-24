import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { formatDate, formatDuration, humanDuration } from "@/lib/format";
import type { Sponsorship } from "@/lib/sponsorships";
import { listMySponsorships } from "@/lib/sponsorships";

const ACTIVE_STATUSES = new Set(["active", "paused", "overdue"]);

/** D-06 — cards for every orphan the donor currently sponsors.
 *
 * Derived from GET /me/sponsorships, filtered to the live statuses
 * (active / paused / overdue). Each card reads as a warm "relationship"
 * — how long they've cared, what they've given, the next gentle step —
 * not a cold invoice. Links to the sponsored-orphan detail (D-07),
 * keyed by orphan_id, and shares its date/duration phrasing via
 * `@/lib/format`. */
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
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
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
              <OrphanCard sponsorship={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrphanCard({ sponsorship: s }: { sponsorship: Sponsorship }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const name = s.orphan_name ?? "—";

  const since = humanDuration(s.start_date);
  const sinceText = since
    ? t("donor.orphans.since", {
        name,
        duration: formatDuration(since, t),
      })
    : null;

  const showNext =
    s.next_payment_date && (s.status === "active" || s.status === "paused");

  return (
    <Link
      to={`/donor/orphans/${s.orphan_id}`}
      className="card flex h-full flex-col gap-3 transition hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-tranquil-200 text-trust-600 dark:bg-gray-700"
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
          <p className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
            {name}
          </p>
          {s.orphan_code && (
            <p className="font-mono text-xs text-gray-500">{s.orphan_code}</p>
          )}
        </div>
        <StatusDot status={s.status} />
      </div>

      {sinceText && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{sinceText}</p>
      )}

      <div className="mt-auto space-y-1">
        <p className="text-sm text-trust-700 dark:text-trust-200">
          {t("donor.orphans.contribution", {
            amount: s.total_paid,
            currency: s.currency,
            name,
          })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("donor.orphans.monthlyDetail", {
            amount: s.monthly_amount,
            currency: s.currency,
          })}
        </p>
      </div>

      {s.status === "overdue" ? (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-500/10 dark:text-warning-100">
          {t("donor.orphans.overdueReminder", { name })}
        </p>
      ) : (
        showNext && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("donor.orphans.nextPayment", {
              date: formatDate(s.next_payment_date as string, lang),
            })}
          </p>
        )
      )}

      <span className="text-sm font-medium text-trust-600">
        {t("donor.orphans.viewDetail")} →
      </span>
    </Link>
  );
}

/** Soft status indicator — a calm dot + label, not a loud badge.
 * active = tranquil positive, paused = neutral, overdue = gentle amber
 * (kept consistent with the warm overdue reminder, never alarming red). */
function StatusDot({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === "active"
      ? "text-success-700 dark:text-success-200"
      : status === "overdue"
        ? "text-warning-700 dark:text-warning-200"
        : "text-gray-500 dark:text-gray-400";
  const dot =
    status === "active"
      ? "bg-success-500"
      : status === "overdue"
        ? "bg-warning-500"
        : "bg-gray-400";
  return (
    <span
      className={`ms-auto flex shrink-0 items-center gap-1.5 text-xs font-medium ${tone}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {t(`sponsorships.statuses.${status}`, status)}
    </span>
  );
}
