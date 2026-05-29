import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { getPublicOrphan } from "@/lib/public";
import type { Report } from "@/lib/reports";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

const REPORT_SECTIONS = [
  "educational_progress",
  "quran_progress",
  "activities",
  "health_status",
  "psychological_status",
] as const;

/** D-07 — detail for an orphan the donor sponsors.
 *
 * Route: /donor/orphans/:id  (:id is the orphan_id).
 *
 * The sponsorship is located inside the donor's own /me/sponsorships
 * list, so a donor can only ever reach a child they actually sponsor —
 * never another donor's orphan. Financials shown here (monthly amount,
 * next payment, total paid) ARE visible to the donor. Guardian
 * name/phone, partner financials, and other donors are never shown.
 *
 * The "send message" quick action from the mockup is deferred this phase
 * (donor messaging compose, see PR description). */
export function DonorOrphanDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();

  const sponsorshipsQ = useQuery({
    queryKey: ["donor", "me", "portal-sponsorships"],
    queryFn: () => listMySponsorships({ limit: 100 }),
  });
  const reportsQ = useQuery({
    queryKey: ["donor", "me", "reports"],
    queryFn: () => listMyReports({ limit: 100 }),
  });

  const sponsorship = sponsorshipsQ.data?.items.find(
    (s) => s.orphan_id === id,
  );

  // Secondary, best-effort fetch for richer basic info. Sponsored
  // orphans may not be publicly browseable, so failures are ignored.
  const orphanInfoQ = useQuery({
    queryKey: ["public", "orphan", sponsorship?.orphan_code],
    queryFn: () => getPublicOrphan(sponsorship!.orphan_code!),
    enabled: !!sponsorship?.orphan_code,
    retry: false,
  });

  const reports = (reportsQ.data?.items ?? []).filter(
    (r) => r.orphan_id === id,
  );

  if (sponsorshipsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (sponsorshipsQ.error) {
    return (
      <p
        role="alert"
        className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
      >
        {t("common.loadError")}
      </p>
    );
  }

  if (!sponsorship) {
    return (
      <div className="space-y-4">
        <Link to="/donor/orphans" className="text-sm text-trust-600 underline">
          ← {t("donor.orphanDetail.back")}
        </Link>
        <div className="card text-center text-gray-500 dark:text-gray-400">
          {t("donor.orphanDetail.notFound")}
        </div>
      </div>
    );
  }

  const info = orphanInfoQ.data;

  return (
    <div className="space-y-6">
      <Link to="/donor/orphans" className="text-sm text-trust-600 underline">
        ← {t("donor.orphanDetail.back")}
      </Link>

      {/* Hero / basic info */}
      <section className="card">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-tranquil-200 text-trust-600 dark:bg-gray-700"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 19a7 7 0 0 1 14 0" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {sponsorship.orphan_name ?? "—"}
            </h1>
            {sponsorship.orphan_code && (
              <p className="font-mono text-xs text-gray-500">
                {sponsorship.orphan_code}
              </p>
            )}
          </div>
        </div>

        {info && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Field label={t("donor.orphanDetail.age")}>
              {t("donor.orphanDetail.ageValue", { age: info.age_years })}
            </Field>
            <Field label={t("donor.orphanDetail.gender")}>
              {info.gender === "M"
                ? t("donor.orphanDetail.male")
                : t("donor.orphanDetail.female")}
            </Field>
            {info.country && (
              <Field label={t("donor.orphanDetail.country")}>
                {info.country}
              </Field>
            )}
          </dl>
        )}
        {info?.short_description && (
          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {info.short_description}
          </p>
        )}
      </section>

      {/* Sponsorship status / financials (donor-visible) */}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donor.orphanDetail.sponsorshipStatus")}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("donor.sponsorships.status")}>
            {t(`sponsorships.statuses.${sponsorship.status}`, sponsorship.status)}
          </Stat>
          <Stat label={t("donor.orphanDetail.monthlyAmount")}>
            <span className="tabular-nums">
              {sponsorship.monthly_amount} {sponsorship.currency}
            </span>
          </Stat>
          <Stat label={t("donor.orphanDetail.nextPayment")}>
            {sponsorship.next_payment_date
              ? new Date(sponsorship.next_payment_date).toLocaleDateString(
                  i18n.language,
                )
              : t("donor.orphanDetail.notScheduled")}
          </Stat>
          <Stat label={t("donor.orphanDetail.totalPaid")}>
            <span className="tabular-nums">
              {sponsorship.total_paid} {sponsorship.currency}
            </span>
          </Stat>
        </dl>
      </section>

      {/* Published reports */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donor.orphanDetail.reports")}
        </h2>

        {reportsQ.isLoading && <Skeleton className="h-28 w-full" />}

        {!reportsQ.isLoading && reports.length === 0 && (
          <div className="card text-center text-sm text-gray-500 dark:text-gray-400">
            {t("donor.orphanDetail.noReports")}
          </div>
        )}

        {reports.map((r) => (
          <ReportCard key={r.id} report={r} lang={i18n.language} />
        ))}
      </section>
    </div>
  );
}

function ReportCard({ report, lang }: { report: Report; lang: string }) {
  const { t } = useTranslation();
  const sections = REPORT_SECTIONS.map((key) => ({
    key,
    value: report[key] as Record<string, unknown> | null,
  })).filter((s) => s.value && Object.keys(s.value).length > 0);

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-tranquil-200 px-2 py-0.5 text-xs font-medium text-trust-700 dark:bg-gray-700 dark:text-tranquil-200">
          {t(`reports.types.${report.report_type}`, report.report_type)}
        </span>
        <span className="text-xs text-gray-500">
          {new Date(report.period_start).toLocaleDateString(lang)} –{" "}
          {new Date(report.period_end).toLocaleDateString(lang)}
        </span>
      </header>

      {report.summary && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("reports.sections.summary")}
          </h3>
          <p className="mt-1 whitespace-pre-line text-sm text-gray-700 dark:text-gray-300">
            {report.summary}
          </p>
        </div>
      )}

      {sections.map(({ key, value }) => (
        <div key={key}>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t(`reports.sections.${key}`)}
          </h3>
          <dl className="mt-1 space-y-0.5 text-sm">
            {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="text-gray-500">{k}:</dt>
                <dd className="text-gray-700 dark:text-gray-300">
                  {String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </article>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
        {children}
      </dd>
    </div>
  );
}
