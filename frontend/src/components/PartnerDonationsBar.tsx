import { useTranslation } from "react-i18next";

import type { DonationsByPartner } from "@/lib/stats";

/** Horizontal bar list: each partner's total, normalised against the
 * top partner's total. Keeps the partner name readable on narrow
 * screens by not trying to be an SVG. */
export function PartnerDonationsBar({ data }: { data: DonationsByPartner }) {
  const { t, i18n } = useTranslation();
  if (data.items.length === 0) {
    return <p className="text-sm text-slate-500">{t("common.empty")}</p>;
  }
  const max = Math.max(...data.items.map((it) => Number(it.payments_total)), 1);
  const fmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  return (
    <ul className="space-y-2">
      {data.items.map((it) => {
        const v = Number(it.payments_total);
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <li key={it.partner_id} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-700">
                <span className="me-2 font-mono text-xs text-slate-500">
                  {it.partner_code}
                </span>
                {it.partner_name}
              </span>
              <span className="font-medium text-slate-900">{fmt.format(v)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-snow">
              <div
                className="h-full bg-trust"
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
