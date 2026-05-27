import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";
import { getPublicStats } from "@/lib/public";
import { useAuthStore } from "@/store/auth";

/**
 * `/` — public landing for anonymous visitors. Logged-in users get
 * dispatched to their home area (admin or donor) on first paint so
 * the landing isn't shown to people who already have a relationship
 * with the platform.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.accessToken);
  const { role, homePath } = useRole();
  const statsQ = useQuery({
    queryKey: ["public", "stats"],
    queryFn: getPublicStats,
  });

  // Authenticated visitors: send them to their area as soon as role is
  // known. We can't redirect before /me resolves because we don't know
  // the role yet — render the landing in the meantime (visible flash is
  // OK because logged-in donors typically land here only on first login).
  if (token && role !== undefined && homePath !== "/") {
    return <Navigate to={homePath} replace />;
  }

  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-gradient-to-br from-trust to-trust/80 px-8 py-16 text-white">
        <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
          {t("landing.hero.title")}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-white/90">
          {t("landing.hero.subtitle")}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/orphans"
            className="rounded-lg bg-white px-5 py-3 font-medium text-trust hover:bg-snow"
          >
            {t("landing.hero.browse")}
          </Link>
          <Link
            to="/signup"
            className="rounded-lg border border-white/30 px-5 py-3 font-medium text-white hover:bg-white/10"
          >
            {t("landing.hero.signup")}
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("landing.stats.available")} value={statsQ.data?.orphans_available} />
        <StatCard label={t("landing.stats.sponsored")} value={statsQ.data?.orphans_sponsored} accent />
        <StatCard label={t("landing.stats.donors")} value={statsQ.data?.donors_total} />
        <StatCard label={t("landing.stats.countries")} value={statsQ.data?.countries_served} />
      </section>

      <section className="card space-y-3">
        <h2 className="text-2xl font-semibold text-slate-900">
          {t("landing.howItWorks.title")}
        </h2>
        <ol className="list-decimal space-y-2 ps-5 text-slate-700">
          <li>{t("landing.howItWorks.step1")}</li>
          <li>{t("landing.howItWorks.step2")}</li>
          <li>{t("landing.howItWorks.step3")}</li>
        </ol>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | undefined;
  accent?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-bold ${
          accent ? "text-emerald-700" : "text-slate-900"
        }`}
      >
        {value === undefined ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}
