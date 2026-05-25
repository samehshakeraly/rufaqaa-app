import { useTranslation } from "react-i18next";

import type { PaymentsTimeseries } from "@/lib/stats";

/**
 * Tiny inline SVG bar chart. Pure markup so we don't have to ship a
 * full chart library for a single visualisation. Each bar's height is
 * normalised against the max value in the series; the y-axis label
 * shows the same max so the user can read magnitudes.
 */
export function PaymentsChart({ data }: { data: PaymentsTimeseries }) {
  const { t, i18n } = useTranslation();

  if (data.months.length === 0) {
    return <p className="text-sm text-slate-500">{t("common.empty")}</p>;
  }

  const totals = data.months.map((m) => Number(m.payments_total));
  const max = Math.max(...totals, 1);
  const width = 600;
  const height = 180;
  const padding = { top: 8, right: 16, bottom: 24, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barGap = 6;
  const barW = (innerW - barGap * (data.months.length - 1)) / data.months.length;

  const fmt = new Intl.DateTimeFormat(i18n.language, { month: "short" });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl">
      {/* y-axis max label */}
      <text x={4} y={padding.top + 10} className="fill-slate-500 text-[10px]">
        {max.toLocaleString(i18n.language, { maximumFractionDigits: 0 })}
      </text>
      <text
        x={4}
        y={padding.top + innerH}
        className="fill-slate-500 text-[10px]"
      >
        0
      </text>
      {data.months.map((m, i) => {
        const v = Number(m.payments_total);
        const h = max > 0 ? (v / max) * innerH : 0;
        const x = padding.left + i * (barW + barGap);
        const y = padding.top + (innerH - h);
        const monthDate = new Date(m.month);
        return (
          <g key={m.month}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              className="fill-trust"
              rx={2}
            >
              <title>
                {monthDate.toLocaleDateString(i18n.language, {
                  month: "long",
                  year: "numeric",
                })}
                {": "}
                {v.toLocaleString(i18n.language)}
              </title>
            </rect>
            <text
              x={x + barW / 2}
              y={height - 6}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {fmt.format(monthDate)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
