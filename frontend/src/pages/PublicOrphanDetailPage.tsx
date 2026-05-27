import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { getPublicOrphan } from "@/lib/public";
import { useAuthStore } from "@/store/auth";

/**
 * Public detail page for one orphan. The "Sponsor" CTA is auth-aware:
 * - anon → /signup?intent=sponsor:<code>
 * - logged-in donor → /sponsor/<code>/checkout
 * - admin/staff → admin-driven flow under /admin/sponsorships
 */
export function PublicOrphanDetailPage() {
  const { t } = useTranslation();
  const { code = "" } = useParams<{ code: string }>();
  const token = useAuthStore((s) => s.accessToken);
  const { isDonor, emailVerified } = useRole();

  const q = useQuery({
    queryKey: ["public", "orphan", code],
    queryFn: () => getPublicOrphan(code),
    enabled: !!code,
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.error || !q.data) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }
  const o = q.data;

  const sponsorHref =
    token && isDonor && emailVerified
      ? `/sponsor/${o.code}/checkout`
      : token
        ? "/verify-email"
        : `/signup?intent=sponsor:${o.code}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/orphans" className="text-sm text-trust underline">
        ← {t("public.orphans.title")}
      </Link>

      <article className="card space-y-3">
        <p className="font-mono text-xs text-slate-500">{o.code}</p>
        <h1 className="text-3xl font-bold text-slate-900">{o.first_name}</h1>
        <p className="text-slate-600">
          {t("public.orphans.age", { age: o.age_years })} ·{" "}
          {o.gender === "M" ? t("orphans.male") : t("orphans.female")}
          {o.country ? ` · ${o.country}` : ""}
        </p>
        {o.partner_organization_name && (
          <p className="text-sm text-slate-500">{o.partner_organization_name}</p>
        )}
        {o.short_description && (
          <p className="mt-2 text-sm text-slate-700">{o.short_description}</p>
        )}
      </article>

      <Link to={sponsorHref} className="btn-primary block text-center">
        {t("public.orphans.sponsor")}
      </Link>
    </div>
  );
}
