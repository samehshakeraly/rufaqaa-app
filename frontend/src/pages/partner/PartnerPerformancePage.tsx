import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Icon, PM_ICONS } from "@/components/partner/icons";
import { PartnerTopbar } from "@/components/partner/PartnerTopbar";
import {
  fetchPaymentsTimeseries,
  fetchSummary,
  type PaymentsTimeseries,
} from "@/lib/stats";

import "./PartnerPerformancePage.css";

const PLACEHOLDER = "—";

export function PartnerPerformancePage() {
  const { t, i18n } = useTranslation();

  const summaryQ = useQuery({ queryKey: ["stats", "summary"], queryFn: fetchSummary });
  const seriesQ = useQuery({
    queryKey: ["stats", "payments-timeseries"],
    queryFn: fetchPaymentsTimeseries,
  });

  const summary = summaryQ.data;
  const int = (n: number | undefined) =>
    n === undefined ? PLACEHOLDER : n.toLocaleString(i18n.language);

  // Sponsorship rate = sponsored / total orphans (real, from /stats/summary).
  const sponsorRate =
    summary && summary.orphans_total > 0
      ? Math.round((summary.orphans_sponsored / summary.orphans_total) * 100)
      : undefined;

  return (
    <>
      <PartnerTopbar
        title={t("partner.performance.title")}
        subtitle={t("partner.performance.subtitle")}
        actions={
          <>
            <button type="button" className="pm-filter-pill">
              {t("partner.performance.period")}
              <Icon>{PM_ICONS.chevronDown}</Icon>
            </button>
            <button type="button" className="pm-btn-secondary">
              <Icon>{PM_ICONS.download}</Icon>
              {t("partner.performance.exportPdf")}
            </button>
            <button type="button" className="pm-btn-primary">
              <Icon>{PM_ICONS.download}</Icon>
              {t("partner.performance.fullReport")}
            </button>
          </>
        }
      />

      <div className="pm-page">
        {/* KPI row — real where the stats API exposes it. */}
        <div className="pm-perf-kpis">
          <PerfKpi
            label={t("partner.performance.kpi.orphans")}
            value={int(summary?.orphans_total)}
            unit={t("partner.performance.unitOrphans")}
            bench={t("partner.performance.kpi.orphansBench")}
          />
          <PerfKpi
            label={t("partner.performance.kpi.sponsorRate")}
            value={sponsorRate === undefined ? PLACEHOLDER : String(sponsorRate)}
            unit="%"
            bench={
              <>
                {t("partner.performance.kpi.sponsoredOf", {
                  sponsored: int(summary?.orphans_sponsored),
                  total: int(summary?.orphans_total),
                })}
              </>
            }
          />
          <PerfKpi
            label={t("partner.performance.kpi.activeSponsorships")}
            value={int(summary?.sponsorships_active)}
            unit={t("partner.performance.unitSponsorships")}
            bench={
              summary && summary.sponsorships_overdue > 0 ? (
                <span className="warn">
                  {t("partner.performance.kpi.overdue", {
                    count: summary.sponsorships_overdue,
                  })}
                </span>
              ) : (
                t("partner.performance.kpi.noOverdue")
              )
            }
          />
          {/* TODO(backend): no parent-satisfaction survey metric exposed. */}
          <PerfKpi
            label={t("partner.performance.kpi.satisfaction")}
            value={PLACEHOLDER}
            unit="/ 5"
            bench={t("partner.performance.kpi.satisfactionBench")}
          />
        </div>

        <div className="pm-perf-grid">
          <div>
            {/* Trend chart — real payments timeseries (the partner's
                org-scoped completed-payment totals, last 6 months). */}
            <div className="pm-perf-card">
              <div className="pm-perf-card-head">
                <h3>
                  <Icon>{PM_ICONS.trendingUp}</Icon>
                  {t("partner.performance.trendTitle")}
                </h3>
                <span className="pm-head-meta">{t("partner.performance.trendMeta")}</span>
              </div>
              <div className="pm-perf-card-body">
                <div className="pm-chart-legend">
                  <span className="pm-chart-legend-item">
                    <span className="pm-chart-legend-dot actual" />
                    {t("partner.performance.legendActual")}
                  </span>
                  {/* TODO(backend): no monthly-target series exposed. */}
                  <span className="pm-chart-legend-item muted">
                    <span className="pm-chart-legend-dot target" />
                    {t("partner.performance.legendTarget")}
                  </span>
                </div>
                {seriesQ.isLoading ? (
                  <div className="pm-state">{t("common.loading")}</div>
                ) : (
                  <TrendChart series={seriesQ.data} />
                )}
              </div>
            </div>

            {/* Region table — TODO(backend): no orphans-by-region
                aggregation endpoint. Styled empty-state placeholder. */}
            <div className="pm-perf-card">
              <div className="pm-perf-card-head">
                <h3>
                  <Icon>{PM_ICONS.globe}</Icon>
                  {t("partner.performance.regionTitle")}
                </h3>
              </div>
              <div className="pm-empty neutral">
                <Icon className="pm-icon">{PM_ICONS.globe}</Icon>
                <h3>{t("partner.performance.comingSoon")}</h3>
                <p>{t("partner.performance.regionEmpty")}</p>
              </div>
            </div>
          </div>

          <aside>
            {/* Workload donut — TODO(backend): no workload-breakdown
                endpoint. Styled empty-state placeholder. */}
            <div className="pm-perf-card">
              <div className="pm-perf-card-head">
                <h3>
                  <Icon>{PM_ICONS.pie}</Icon>
                  {t("partner.performance.workloadTitle")}
                </h3>
              </div>
              <div className="pm-empty neutral">
                <Icon className="pm-icon">{PM_ICONS.pie}</Icon>
                <h3>{t("partner.performance.comingSoon")}</h3>
                <p>{t("partner.performance.workloadEmpty")}</p>
              </div>
            </div>

            {/* SLA — TODO(backend): no SLA-compliance endpoint. */}
            <div className="pm-perf-card">
              <div className="pm-perf-card-head">
                <h3>
                  <Icon>{PM_ICONS.clock}</Icon>
                  {t("partner.performance.slaTitle")}
                </h3>
              </div>
              <div className="pm-empty neutral">
                <Icon className="pm-icon">{PM_ICONS.clock}</Icon>
                <h3>{t("partner.performance.comingSoon")}</h3>
                <p>{t("partner.performance.slaEmpty")}</p>
              </div>
            </div>

            {/* Health flags — the one we can source is overdue
                sponsorships (real, from /stats/summary). */}
            <div className="pm-perf-card">
              <div className="pm-perf-card-head">
                <h3>
                  <Icon>{PM_ICONS.star}</Icon>
                  {t("partner.performance.healthTitle")}
                </h3>
              </div>
              <div className="pm-health-body">
                {summary && summary.sponsorships_overdue > 0 ? (
                  <div className="pm-health-flag warn">
                    <Icon className="pm-icon">{PM_ICONS.alert}</Icon>
                    <span>
                      {t("partner.performance.health.overdue", {
                        count: summary.sponsorships_overdue,
                      })}
                    </span>
                  </div>
                ) : (
                  <div className="pm-health-flag ok">
                    <Icon className="pm-icon">{PM_ICONS.check}</Icon>
                    <span>{t("partner.performance.health.good")}</span>
                  </div>
                )}
                {summary && summary.orphans_available > 0 && (
                  <div className="pm-health-flag info">
                    <Icon className="pm-icon">{PM_ICONS.info}</Icon>
                    <span>
                      {t("partner.performance.health.available", {
                        count: summary.orphans_available,
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function PerfKpi({
  label,
  value,
  unit,
  bench,
}: {
  label: string;
  value: string;
  unit?: string;
  bench?: React.ReactNode;
}) {
  return (
    <div className="pm-perf-kpi">
      <div className="pm-perf-kpi-top">
        <div className="pm-perf-kpi-label">{label}</div>
      </div>
      <div className="pm-perf-kpi-value">
        <span className="pm-latin">{value}</span>
        {unit ? <span className="pm-unit">{unit}</span> : null}
      </div>
      {bench ? <div className="pm-perf-bench">{bench}</div> : null}
    </div>
  );
}

// SVG area chart built from the real payments timeseries (last 6 months).
// Wrapped dir="ltr" so time reads oldest→newest regardless of page dir.
function TrendChart({ series }: { series: PaymentsTimeseries | undefined }) {
  const { t, i18n } = useTranslation();
  const months = (series?.months ?? []).slice(-6);
  if (months.length === 0) {
    return (
      <div className="pm-empty neutral">
        <Icon className="pm-icon">{PM_ICONS.trendingUp}</Icon>
        <h3>{t("partner.performance.comingSoon")}</h3>
        <p>{t("partner.performance.trendEmpty")}</p>
      </div>
    );
  }
  const W = 600;
  const H = 160;
  const vals = months.map((m) => Number(m.payments_total));
  const max = Math.max(...vals, 1);
  const n = months.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => 20 + (1 - v / max) * (H - 28);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`);
  const linePath = `M${pts.join(" L")}`;
  const areaPath = `M${x(0)},${H} L${pts.join(" L")} L${x(n - 1)},${H} Z`;
  const monthShort = (d: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(new Date(d));

  return (
    <>
      <div className="pm-trend-chart" dir="ltr" role="img" aria-label={t("partner.performance.trendTitle")}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="pm-perf-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#769fcd" stopOpacity=".25" />
              <stop offset="100%" stopColor="#769fcd" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#pm-perf-grad)" />
          <path d={linePath} fill="none" stroke="#5b85b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => {
            const [cx, cy] = p.split(",");
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={i === n - 1 ? 5 : 4}
                fill={i === n - 1 ? "#426d9f" : "white"}
                stroke={i === n - 1 ? "white" : "#5b85b8"}
                strokeWidth="2"
              />
            );
          })}
        </svg>
      </div>
      <div className="pm-chart-x-labels" dir="ltr" aria-hidden="true">
        {months.map((m, i) => (
          <span key={m.month} className={i === n - 1 ? "current" : undefined}>
            {monthShort(m.month)}
          </span>
        ))}
      </div>
    </>
  );
}
