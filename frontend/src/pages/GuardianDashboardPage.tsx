import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  CaseStatusBadge,
  SponsoredBadge,
} from "@/components/guardian/GuardianBits";
import { Skeleton } from "@/components/Skeleton";
import { ageFromDob } from "@/lib/age";
import {
  getGuardianMe,
  listMyOrphans,
  type GuardianOrphan,
} from "@/lib/guardianSelf";

export function GuardianDashboardPage() {
  const { t } = useTranslation();
  const profile = useQuery({ queryKey: ["guardian", "me"], queryFn: getGuardianMe });
  const orphans = useQuery({
    queryKey: ["guardian", "me", "orphans"],
    queryFn: listMyOrphans,
  });

  const firstName = profile.data?.full_name.trim().split(/\s+/)[0] ?? "";
  const relation = profile.data?.relation;

  return (
    <div className="space-y-6">
      {/* Welcome card */}
      <section className="card">
        {!profile.data ? (
          <div className="space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {t("guardian.dashboard.welcome", { name: firstName })}
            </h1>
            {relation && (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t(`guardian.relations.${relation}`, { defaultValue: relation })}
              </p>
            )}
          </>
        )}
      </section>

      {/* Top-level quick action */}
      <div className="flex flex-wrap gap-3">
        <Link to="/guardian/messages" className="btn-primary">
          {t("guardian.dashboard.messages")}
        </Link>
      </div>

      {/* Orphans */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t("guardian.dashboard.yourOrphans")}
        </h2>

        {orphans.isLoading && <Skeleton className="h-40 w-full" />}

        {orphans.data?.length === 0 && (
          <div className="card text-center text-slate-500 dark:text-slate-400">
            {t("guardian.dashboard.empty")}
          </div>
        )}

        {orphans.data && orphans.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orphans.data.map((o) => (
              <OrphanCard key={o.id} orphan={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrphanCard({ orphan: o }: { orphan: GuardianOrphan }) {
  const { t } = useTranslation();
  const sponsored = Boolean(o.financials?.is_sponsored);

  return (
    <article className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            {o.first_name} {o.family_name}
          </h3>
          <p className="font-mono text-xs text-slate-500 tabular-nums">{o.code}</p>
        </div>
        <CaseStatusBadge status={o.case_status} />
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
        <div className="flex gap-1">
          <dt className="text-slate-500">{t("guardian.detail.gender")}:</dt>
          <dd>{t(`guardian.gender.${o.gender}`, { defaultValue: o.gender })}</dd>
        </div>
        <div className="flex gap-1">
          <dd className="tabular-nums">
            {t("guardian.orphan.age", { age: ageFromDob(o.date_of_birth) })}
          </dd>
        </div>
      </dl>

      <div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{t("guardian.dashboard.profileCompletion")}</span>
          <span className="tabular-nums">{o.profile_completion_percentage}%</span>
        </div>
        <div
          className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"
          role="progressbar"
          aria-valuenow={o.profile_completion_percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("guardian.dashboard.profileCompletion")}
        >
          <div
            className="h-full rounded-full bg-trust-500"
            style={{ inlineSize: `${o.profile_completion_percentage}%` }}
          />
        </div>
      </div>

      {sponsored && (
        <div>
          <SponsoredBadge />
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link
          to={`/guardian/reports/new?orphan_id=${o.id}`}
          className="rounded-lg border border-trust bg-trust px-3 py-1.5 text-sm text-white hover:bg-trust-600"
        >
          {t("guardian.orphan.uploadReport")}
        </Link>
        <Link
          to={`/guardian/orphans/${o.id}`}
          className="rounded-lg border border-sky px-3 py-1.5 text-sm text-slate-700 hover:bg-tranquil dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {t("guardian.orphan.viewProfile")}
        </Link>
      </div>
    </article>
  );
}
