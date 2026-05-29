import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  CaseStatusBadge,
  ReportStatusBadge,
  SponsoredBadge,
} from "@/components/guardian/GuardianBits";
import { Skeleton } from "@/components/Skeleton";
import { ageFromDob } from "@/lib/age";
import { listMyOrphans, listMyReports } from "@/lib/guardianSelf";
import type { Report } from "@/lib/reports";

export function GuardianOrphanDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();

  // No single-orphan guardian endpoint exists; the family list is the
  // source of truth (and the backend already scopes it to this guardian).
  const orphans = useQuery({
    queryKey: ["guardian", "me", "orphans"],
    queryFn: listMyOrphans,
  });
  const reports = useQuery({
    queryKey: ["guardian", "me", "reports", id],
    queryFn: () => listMyReports(id),
    enabled: Boolean(id),
  });

  const orphan = orphans.data?.find((o) => o.id === id);

  if (orphans.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!orphan) {
    return (
      <div className="card space-y-3 text-center text-slate-500 dark:text-slate-400">
        <p>{t("guardian.detail.loadError")}</p>
        <Link to="/guardian" className="btn-primary inline-block">
          {t("guardian.detail.backToDashboard")}
        </Link>
      </div>
    );
  }

  const sponsored = Boolean(orphan.financials?.is_sponsored);

  return (
    <div className="space-y-6">
      <Link
        to="/guardian"
        className="text-sm text-trust underline underline-offset-2"
      >
        {t("guardian.detail.backToDashboard")}
      </Link>

      {/* Hero / basic info */}
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {orphan.first_name} {orphan.family_name}
            </h1>
            <p className="font-mono text-xs text-slate-500 tabular-nums">
              {orphan.code}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CaseStatusBadge status={orphan.case_status} />
            {/* Privacy: badge only — never amount / balance / sponsor id. */}
            {sponsored && <SponsoredBadge short />}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Info label={t("guardian.orphan.age")}>
            <span className="tabular-nums">{ageFromDob(orphan.date_of_birth)}</span>
          </Info>
          <Info label={t("guardian.detail.dateOfBirth")}>
            <span className="tabular-nums">{orphan.date_of_birth}</span>
          </Info>
          <Info label={t("guardian.detail.gender")}>
            {t(`guardian.gender.${orphan.gender}`, { defaultValue: orphan.gender })}
          </Info>
          <Info label={t("guardian.detail.profileCompletion")}>
            <span className="tabular-nums">
              {orphan.profile_completion_percentage}%
            </span>
          </Info>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Link
            to={`/guardian/reports/new?orphan_id=${orphan.id}`}
            className="btn-primary"
          >
            {t("guardian.detail.newReport")}
          </Link>
          <Link
            to="/guardian/messages"
            className="rounded-lg border border-sky px-4 py-2 text-sm font-medium text-slate-700 hover:bg-tranquil dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t("guardian.detail.sendMessage")}
          </Link>
        </div>
      </section>

      {/* Reports */}
      <section className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t("guardian.detail.reports")}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("guardian.detail.reportsSubtitle")}
          </p>
        </div>

        {reports.isLoading && <Skeleton className="h-24 w-full" />}

        {reports.data?.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("guardian.detail.noReports")}
          </p>
        )}

        {reports.data && reports.data.length > 0 && (
          <ul className="divide-y divide-sky/40">
            {reports.data.map((r) => (
              <ReportRow key={r.id} report={r} orphanId={orphan.id} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
        {children}
      </dd>
    </div>
  );
}

function ReportRow({
  report: r,
  orphanId,
}: {
  report: Report;
  orphanId: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900 tabular-nums dark:text-slate-100">
          {r.period_start} — {r.period_end}
        </span>
        <ReportStatusBadge status={r.status} />
      </div>
      {r.summary && (
        <p className="text-sm text-slate-600 dark:text-slate-300">{r.summary}</p>
      )}
      {r.status === "rejected" && (
        <div className="mt-1 rounded-lg bg-danger-50 p-2 text-sm text-danger-700">
          {r.rejection_reason && (
            <p>
              <span className="font-medium">
                {t("guardian.report.rejectionReason")}:
              </span>{" "}
              {r.rejection_reason}
            </p>
          )}
          <Link
            to={`/guardian/reports/new?orphan_id=${orphanId}`}
            className="mt-1 inline-block font-medium text-trust underline underline-offset-2"
          >
            {t("guardian.report.resubmit")}
          </Link>
        </div>
      )}
    </li>
  );
}
