import { useTranslation } from "react-i18next";

import type { PlatformByOrg } from "@/lib/stats";

/**
 * Horizontal bar list of the top organisations by completed-donation
 * total, normalised against the top org. Mirrors PartnerDonationsBar but
 * keyed on platform org rankings. Figures use tabular-nums for alignment.
 */
export function OrgDonationsBar({ data }: { data: PlatformByOrg }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");

  if (data.items.length === 0) {
    return <p className="text-sm text-slate-500">{t("common.empty")}</p>;
  }
  const max = Math.max(...data.items.map((it) => Number(it.donations_total)), 1);
  const fmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  return (
    <ul className="space-y-2">
      {data.items.map((it) => {
        const v = Number(it.donations_total);
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <li key={it.organization_id} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-700 dark:text-slate-200">
                <span className="me-2 font-mono text-xs text-slate-500">
                  {it.code}
                </span>
                {isAr ? it.name_ar : it.name_en}
              </span>
              <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                {fmt.format(v)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-snow dark:bg-gray-700">
              <div
                className="h-full bg-trust"
                style={{ inlineSize: `${pct.toFixed(1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
