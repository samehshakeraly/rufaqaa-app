import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { listPublicOrphans } from "@/lib/public";

/** Public, anonymous-safe orphan browse with country / gender / age filters. */
export function PublicOrphansPage() {
  const { t } = useTranslation();
  const [country, setCountry] = useState("");
  const [gender, setGender] = useState<"" | "M" | "F">("");

  const { data, isLoading } = useQuery({
    queryKey: ["public", "orphans", { country, gender }],
    queryFn: () =>
      listPublicOrphans({
        limit: 50,
        ...(country ? { country } : {}),
        ...(gender ? { gender } : {}),
      }),
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">
          {t("public.orphans.title")}
        </h1>
        <p className="text-slate-600">{t("public.orphans.subtitle")}</p>
      </header>

      <div className="card flex flex-wrap gap-3">
        <label className="block">
          <span className="me-2 text-sm text-slate-600">
            {t("public.orphans.country")}
          </span>
          <input
            className="input w-24"
            maxLength={2}
            placeholder="KW"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </label>
        <label className="block">
          <span className="me-2 text-sm text-slate-600">
            {t("public.orphans.gender")}
          </span>
          <select
            className="input w-32"
            value={gender}
            onChange={(e) => setGender(e.target.value as "" | "M" | "F")}
          >
            <option value="">—</option>
            <option value="M">{t("orphans.male")}</option>
            <option value="F">{t("orphans.female")}</option>
          </select>
        </label>
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-slate-500">
          {t("common.empty")}
        </div>
      )}

      {data && data.items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((o) => (
            <li key={o.code} className="card flex flex-col gap-3">
              <div>
                <p className="font-mono text-xs text-slate-500">{o.code}</p>
                <h3 className="text-lg font-semibold">{o.first_name}</h3>
                <p className="text-sm text-slate-600">
                  {t("public.orphans.age", { age: o.age_years })} ·{" "}
                  {o.gender === "M"
                    ? t("orphans.male")
                    : t("orphans.female")}
                  {o.country ? ` · ${o.country}` : ""}
                </p>
                {o.partner_organization_name && (
                  <p className="mt-1 text-xs text-slate-500">
                    {o.partner_organization_name}
                  </p>
                )}
              </div>
              <Link
                to={`/orphans/${o.code}`}
                className="btn-primary mt-auto text-center"
              >
                {t("public.orphans.viewAndSponsor")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
