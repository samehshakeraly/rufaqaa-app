import { useTranslation } from "react-i18next";

import type { SponsorshipsByStatus } from "@/lib/stats";

/** Donut chart for sponsorship-status breakdown. Pure SVG so we don't
 * pull in a chart library. Each slice is a stroke-dashoffset arc on a
 * common circle. */
const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  pending: "#94a3b8",
  paused: "#f59e0b",
  overdue: "#ef4444",
  cancelled: "#64748b",
  completed: "#3b82f6",
  transferred: "#8b5cf6",
};

export function SponsorshipsDonut({ data }: { data: SponsorshipsByStatus }) {
  const { t } = useTranslation();
  const total = data.slices.reduce((acc, s) => acc + s.count, 0);

  if (total === 0) {
    return <p className="text-sm text-slate-500">{t("common.empty")}</p>;
  }

  const radius = 50;
  const stroke = 18;
  const c = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-40 w-40 -rotate-90">
        <circle
          cx={70}
          cy={70}
          r={radius}
          fill="transparent"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        {data.slices.map((s) => {
          const frac = s.count / total;
          const dash = frac * c;
          const color = STATUS_COLORS[s.status] ?? "#64748b";
          const node = (
            <circle
              key={s.status}
              cx={70}
              cy={70}
              r={radius}
              fill="transparent"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            >
              <title>
                {t(`sponsorships.statuses.${s.status}`, s.status)}: {s.count}
              </title>
            </circle>
          );
          offset += dash;
          return node;
        })}
        <text
          x={70}
          y={75}
          textAnchor="middle"
          className="fill-slate-700 text-lg font-semibold"
          transform="rotate(90 70 70)"
        >
          {total}
        </text>
      </svg>

      <ul className="space-y-1 text-sm">
        {data.slices.map((s) => (
          <li key={s.status} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ backgroundColor: STATUS_COLORS[s.status] ?? "#64748b" }}
            />
            <span className="text-slate-700">
              {t(`sponsorships.statuses.${s.status}`, s.status)}
            </span>
            <span className="text-slate-500">— {s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
