import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { getOrphan, getOrphanTimeline } from "@/lib/orphans";

const KIND_ACCENT: Record<string, string> = {
  sponsorship: "border-trust",
  payment: "border-emerald-400",
  report: "border-amber-400",
  media: "border-sky",
};

export function OrphanDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { data: orphan, isLoading, error } = useQuery({
    queryKey: ["orphan", id],
    queryFn: () => getOrphan(id),
    enabled: !!id,
  });
  const { data: timeline } = useQuery({
    queryKey: ["orphan", id, "timeline"],
    queryFn: () => getOrphanTimeline(id),
    enabled: !!id,
  });

  if (isLoading) return <p className="text-slate-500">{t("common.loading")}</p>;
  if (error || !orphan) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {orphan.first_name} {orphan.family_name}
          </h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{orphan.code}</span> ·{" "}
            {t(`orphans.caseStatus.${orphan.case_status}`, orphan.case_status)}
          </p>
        </div>
        <Link
          to="/orphans"
          className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
        >
          ← {t("orphans.title")}
        </Link>
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("orphans.title")}</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t("orphans.dateOfBirth")}</dt>
            <dd className="font-medium">{orphan.date_of_birth}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("orphans.gender")}</dt>
            <dd className="font-medium">
              {orphan.gender === "M" ? t("orphans.male") : t("orphans.female")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("orphans.status")}</dt>
            <dd className="font-medium">
              {t(`orphans.caseStatus.${orphan.case_status}`, orphan.case_status)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t("orphans.balance")}</dt>
            <dd className="font-medium">{orphan.current_balance}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("orphans.timeline")}</h2>
        {!timeline && <p className="text-slate-500">{t("common.loading")}</p>}
        {timeline && timeline.items.length === 0 && (
          <p className="text-slate-500">{t("common.empty")}</p>
        )}
        {timeline && timeline.items.length > 0 && (
          <ol className="space-y-2">
            {timeline.items.map((e) => (
              <li
                key={`${e.kind}-${e.entity_id}-${e.when}`}
                className={`flex items-start gap-3 border-s-4 ${KIND_ACCENT[e.kind] ?? "border-sky"} bg-snow px-3 py-2 text-sm`}
              >
                <span className="min-w-[10rem] text-xs text-slate-500">
                  {new Date(e.when).toLocaleString(i18n.language)}
                </span>
                <span className="rounded-md bg-tranquil px-2 py-0.5 text-xs font-medium uppercase">
                  {e.kind}
                </span>
                <span className="flex-1">{e.summary}</span>
                {e.amount && (
                  <span className="font-mono text-xs text-slate-700">
                    {e.amount} {e.currency}
                  </span>
                )}
                {e.status && (
                  <span className="text-xs text-slate-500">{e.status}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
