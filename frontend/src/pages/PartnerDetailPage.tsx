import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton, StatGridSkeleton } from "@/components/Skeleton";
import { getPartner, getPartnerStats } from "@/lib/partners";

export function PartnerDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();

  const partnerQ = useQuery({
    queryKey: ["partner", id],
    queryFn: () => getPartner(id),
    enabled: !!id,
  });
  const statsQ = useQuery({
    queryKey: ["partner", id, "stats"],
    queryFn: () => getPartnerStats(id),
    enabled: !!id,
  });

  if (partnerQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
        <StatGridSkeleton cards={6} />
      </div>
    );
  }
  if (partnerQ.error || !partnerQ.data) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }
  const p = partnerQ.data;
  const name = i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/partners" className="text-sm text-trust underline">
          ← {t("partners.title")}
        </Link>
      </div>

      <div className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{name}</h1>
          <span className="font-mono text-xs text-slate-500">{p.code}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field label={t("partners.country")} value={p.country_code} />
          <Field
            label={t("partners.status")}
            value={t(`partners.statuses.${p.status}`, p.status)}
          />
          <Field label={t("partners.nameAr")} value={p.name_ar} />
          <Field label={t("partners.nameEn")} value={p.name_en ?? "—"} />
        </dl>
      </div>

      {!statsQ.data && <StatGridSkeleton cards={6} />}
      {statsQ.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label={t("dashboard.orphansTotal")}
            value={statsQ.data.orphans_total}
          />
          <Stat
            label={t("dashboard.orphansSponsored")}
            value={statsQ.data.orphans_sponsored}
            accent="emerald"
          />
          <Stat
            label={t("dashboard.orphansAvailable")}
            value={statsQ.data.orphans_available}
          />
          <Stat
            label={t("dashboard.sponsorshipsActive")}
            value={statsQ.data.sponsorships_active}
            accent="emerald"
          />
          <Stat
            label={t("dashboard.sponsorshipsOverdue")}
            value={statsQ.data.sponsorships_overdue}
            accent={
              statsQ.data.sponsorships_overdue > 0 ? "amber" : undefined
            }
          />
          <Stat
            label={t("dashboard.payments30d")}
            value={`${statsQ.data.payments_last_30d_total} (${statsQ.data.payments_last_30d_count})`}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
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
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
