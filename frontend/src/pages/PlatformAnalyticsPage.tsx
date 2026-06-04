import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { listPlatformOrganizations } from "@/lib/platform";
import {
  fetchPlatformByOrg,
  fetchPlatformFunnel,
  fetchPlatformHeadline,
  fetchPlatformPaymentMethods,
  fetchPlatformSummary,
  fetchPlatformTimeseries,
  type PaymentsTimeseries,
} from "@/lib/stats";

import "./PlatformAnalyticsPage.css";

/**
 * SA-03 — Platform Analytics.
 *
 * Pixel-parity port of docs/design/screens/super-admin/SA-03-Analytics.html.
 * App-shell chrome is provided by PlatformLayout.
 *
 * Wired to existing endpoints:
 *   - GET /stats/platform/timeseries      → growth area chart + summary totals
 *   - GET /stats/platform/by-org          → top organizations ranking
 *   - GET /stats/platform/headline        → avg sponsorship duration + donor-activation rate
 *   - GET /stats/platform/funnel          → donor-activation funnel
 *   - GET /stats/platform/payment-methods → payment-method breakdown
 *   - GET /platform/organizations         → orphan distribution by country
 *
 * Still inert / not-yet-sourced (TODO(backend)):
 *   - PDF report export (no endpoint)
 *   - Monthly report read rate (no report-open tracking on the platform)
 */

const RANGES = [3, 6, 12] as const;
type Range = (typeof RANGES)[number];

function Icon({
  children,
  className = "sa-icon",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  trendingUp: (
    <>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  pie: (
    <>
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8" r="6" />
      <polyline points="9 13 9 22 12 19 15 22 15 13" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  funnel: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
};

const PLACEHOLDER = "—";

function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function PlatformAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<Range>(12);

  const { data: timeseries } = useQuery({
    queryKey: ["platform", "timeseries"],
    queryFn: fetchPlatformTimeseries,
  });
  const { data: byOrg } = useQuery({
    queryKey: ["platform", "by-org", 10],
    queryFn: () => fetchPlatformByOrg(10),
  });
  const { data: orgs } = useQuery({
    queryKey: ["platform", "organizations", {}],
    queryFn: () => listPlatformOrganizations(),
  });
  const { data: summary } = useQuery({
    queryKey: ["platform", "summary"],
    queryFn: fetchPlatformSummary,
  });
  const { data: headline } = useQuery({
    queryKey: ["platform", "headline"],
    queryFn: fetchPlatformHeadline,
  });
  const { data: funnel } = useQuery({
    queryKey: ["platform", "funnel"],
    queryFn: fetchPlatformFunnel,
  });
  const { data: paymentMethods } = useQuery({
    queryKey: ["platform", "payment-methods"],
    queryFn: fetchPlatformPaymentMethods,
  });
  const currency = summary?.total_donated_by_currency[0]?.currency ?? null;

  // The backend timeseries is a fixed 12-month window; the range selector
  // trims it client-side so the super_admin can zoom into recent months.
  const ranged: PaymentsTimeseries | undefined = useMemo(() => {
    if (!timeseries) return undefined;
    return { months: timeseries.months.slice(-range) };
  }, [timeseries, range]);

  // Orphans grouped by country — derived from the org list (which carries a
  // per-org total_orphans), so analytics stays read-only against existing
  // routes (no dedicated orphans-by-country endpoint).
  const byCountry = useMemo(() => {
    if (!orgs) return [];
    const counts = new Map<string, { orphans: number; orgs: number }>();
    for (const o of orgs) {
      const cur = counts.get(o.country_code) ?? { orphans: 0, orgs: 0 };
      cur.orphans += o.total_orphans;
      cur.orgs += 1;
      counts.set(o.country_code, cur);
    }
    return [...counts.entries()].sort((a, b) => b[1].orphans - a[1].orphans);
  }, [orgs]);

  const nfmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const cfmt = new Intl.NumberFormat(i18n.language, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const monthShort = (d: Date) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(d);

  const totalDonations = (ranged?.months ?? []).reduce(
    (a, m) => a + Number(m.payments_total),
    0,
  );
  const totalPayments = (ranged?.months ?? []).reduce(
    (a, m) => a + m.payments_count,
    0,
  );
  const totalOrphans = byCountry.reduce((a, [, v]) => a + v.orphans, 0);
  const maxOrphans = Math.max(...byCountry.map(([, v]) => v.orphans), 1);
  const maxOrg = Math.max(...(byOrg?.items ?? []).map((it) => Number(it.donations_total)), 1);
  const maxMethodTotal = Math.max(
    ...(paymentMethods?.items ?? []).map((m) => Number(m.total)),
    1,
  );
  const isAr = i18n.language.startsWith("ar");

  return (
    <div className="sa-analytics">
      <h1 className="sr-only">{t("platform.analytics.title")}</h1>

      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <div className="sa-topbar">
        <div className="sa-topbar-title">
          <h2>{t("platform.analytics.title")}</h2>
          <p>{t("platform.analytics.subtitle")}</p>
        </div>
        <div className="sa-topbar-actions">
          <div className="sa-date-range" role="group" aria-label={t("platform.analytics.range")}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`sa-dr-btn${range === r ? " active" : ""}`}
                aria-pressed={range === r}
                onClick={() => setRange(r)}
              >
                {t("platform.analytics.lastMonths", { count: r })}
              </button>
            ))}
          </div>
          {/* TODO(backend): no PDF report endpoint. */}
          <button type="button" className="sa-btn" disabled aria-disabled="true">
            <Icon className="sa-icon sa-icon-sm">{ICONS.download}</Icon>
            {t("platform.analytics.pdfReport")}
          </button>
        </div>
      </div>

      {/* ── Growth chart ───────────────────────────────────────────── */}
      <div className="sa-section">
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.trendingUp}</Icon>
              {t("platform.analytics.growth.title")}
            </div>
            <span className="sa-panel-meta">
              {t("platform.analytics.lastMonths", { count: range })}
            </span>
          </div>
          <div className="sa-panel-body">
            <div className="sa-growth-summary">
              <div className="sa-summary-item">
                <span className="sa-summary-label">{t("platform.analytics.growth.donations")}</span>
                <span className="sa-summary-value">
                  <span className="latin">{ranged ? cfmt.format(totalDonations) : PLACEHOLDER}</span>
                  {ranged && currency ? <span className="unit">{currency}</span> : null}
                </span>
              </div>
              <div className="sa-summary-item">
                <span className="sa-summary-label">{t("platform.analytics.growth.payments")}</span>
                <span className="sa-summary-value">
                  <span className="latin">{ranged ? nfmt.format(totalPayments) : PLACEHOLDER}</span>
                </span>
              </div>
              <div className="sa-summary-item">
                <span className="sa-summary-label">{t("platform.analytics.growth.orphans")}</span>
                <span className="sa-summary-value">
                  <span className="latin">{orgs ? nfmt.format(totalOrphans) : PLACEHOLDER}</span>
                </span>
              </div>
            </div>

            {!ranged ? (
              <div className="sa-skeleton" style={{ height: 240 }} />
            ) : ranged.months.length === 0 ? (
              <EmptyState title={t("platform.analytics.growth.empty")} icon={ICONS.trendingUp} />
            ) : (
              <GrowthChart
                months={ranged.months}
                monthShort={monthShort}
                title={t("platform.analytics.growth.title")}
              />
            )}

            <div className="sa-chart-legend">
              <span className="sa-chart-legend-item">
                <span className="sa-chart-legend-dot" style={{ background: "#426D9F" }} />
                {t("platform.analytics.growth.legendDonations")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Geo distribution + Payment methods ─────────────────────── */}
      <div className="sa-grid-2 sa-section">
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.globe}</Icon>
              {t("platform.analytics.geo.title")}
            </div>
            {orgs && (
              <span className="sa-panel-meta">
                {t("platform.analytics.geo.meta", {
                  countries: byCountry.length,
                  orphans: totalOrphans,
                })}
              </span>
            )}
          </div>
          <div className="sa-panel-body">
            {!orgs ? (
              <div className="sa-skeleton" style={{ height: 200 }} />
            ) : byCountry.length === 0 ? (
              <EmptyState title={t("common.empty")} icon={ICONS.globe} />
            ) : (
              <div className="sa-geo-list">
                {byCountry.map(([country, v]) => (
                  <div className="sa-geo-row" key={country}>
                    <div className="sa-geo-flag" aria-hidden="true">
                      {flagEmoji(country) || country}
                    </div>
                    <div>
                      <div className="sa-geo-name latin">{country}</div>
                      <div className="sa-geo-detail">
                        {t("platform.analytics.geo.partners", { count: v.orgs })}
                      </div>
                    </div>
                    <div className="sa-geo-bar-wrap">
                      <div className="sa-geo-bar">
                        <div
                          className="sa-geo-bar-fill"
                          style={{ inlineSize: `${((v.orphans / maxOrphans) * 100).toFixed(1)}%` }}
                        />
                      </div>
                      <span className="sa-geo-count latin">{nfmt.format(v.orphans)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Payment methods — completed payments grouped by method. */}
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.pie}</Icon>
              {t("platform.analytics.paymentMethods.title")}
            </div>
          </div>
          <div className="sa-panel-body">
            {!paymentMethods ? (
              <div className="sa-skeleton" style={{ height: 200 }} />
            ) : paymentMethods.items.length === 0 ? (
              <EmptyState title={t("common.empty")} icon={ICONS.pie} />
            ) : (
              <div className="sa-geo-list">
                {paymentMethods.items.map((m) => {
                  const total = Number(m.total);
                  return (
                    <div className="sa-geo-row" key={m.method}>
                      <div className="sa-geo-flag" aria-hidden="true">
                        <Icon className="sa-icon sa-icon-sm">{ICONS.pie}</Icon>
                      </div>
                      <div>
                        <div className="sa-geo-name">
                          {t(`platform.analytics.paymentMethods.method.${m.method}`, m.method)}
                        </div>
                        <div className="sa-geo-detail">
                          {t("platform.analytics.paymentMethods.count", { count: m.count })}
                        </div>
                      </div>
                      <div className="sa-geo-bar-wrap">
                        <div className="sa-geo-bar">
                          <div
                            className="sa-geo-bar-fill"
                            style={{
                              inlineSize: `${((total / maxMethodTotal) * 100).toFixed(1)}%`,
                            }}
                          />
                        </div>
                        <span className="sa-geo-count latin">{nfmt.format(total)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Top organizations (real ranking) ───────────────────────── */}
      <div className="sa-section">
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.award}</Icon>
              {t("platform.analytics.topOrgs")}
            </div>
          </div>
          <div className="sa-panel-body">
            {!byOrg ? (
              <div className="sa-skeleton" style={{ height: 160 }} />
            ) : byOrg.items.length === 0 ? (
              <EmptyState title={t("common.empty")} icon={ICONS.award} />
            ) : (
              <div className="sa-rank-list">
                {byOrg.items.map((it) => {
                  const v = Number(it.donations_total);
                  return (
                    <div className="sa-rank-row" key={it.organization_id}>
                      <div className="sa-rank-head">
                        <span className="sa-rank-name">
                          <span className="sa-rank-code latin">{it.code}</span>
                          {isAr ? it.name_ar : it.name_en}
                        </span>
                        <span className="sa-rank-value latin">{nfmt.format(v)}</span>
                      </div>
                      <div className="sa-rank-bar">
                        <div
                          className="sa-rank-bar-fill"
                          style={{ inlineSize: `${((v / maxOrg) * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Headline stats ──────────────────────────────────────────
          avgDuration + conversion are wired to /stats/platform/headline;
          reportRead stays a PLACEHOLDER (no report-open tracking yet). */}
      <div className="sa-stat-grid sa-section">
        <BigStat
          icon={ICONS.clock}
          label={t("platform.analytics.stats.avgDuration")}
          value={
            headline?.avg_sponsorship_duration_days != null
              ? t("platform.analytics.stats.avgDurationDays", {
                  count: headline.avg_sponsorship_duration_days,
                })
              : PLACEHOLDER
          }
          explain={t("platform.analytics.stats.avgDurationHint")}
        />
        <BigStat
          icon={ICONS.trendingUp}
          label={t("platform.analytics.stats.conversion")}
          value={
            headline ? `${(headline.donor_conversion_rate * 100).toFixed(1)}%` : PLACEHOLDER
          }
          explain={t("platform.analytics.stats.conversionHint")}
        />
        <BigStat
          icon={ICONS.award}
          label={t("platform.analytics.stats.reportRead")}
          value={PLACEHOLDER}
          explain={t("platform.analytics.stats.reportReadHint")}
        />
      </div>

      {/* ── Donor-activation funnel (registered → sponsored → active) ──
          Honest in-platform funnel: no visitor/lead stage exists because
          nothing tracks pre-registration. Widths are relative to the
          registered-donor count. */}
      <div className="sa-section">
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.funnel}</Icon>
              {t("platform.analytics.funnel.title")}
            </div>
          </div>
          <div className="sa-panel-body">
            {!funnel ? (
              <div className="sa-skeleton" style={{ height: 160 }} />
            ) : funnel.registered_donors === 0 ? (
              <EmptyState title={t("common.empty")} icon={ICONS.funnel} />
            ) : (
              <div className="sa-rank-list">
                {(
                  [
                    ["registered", funnel.registered_donors],
                    ["sponsored", funnel.donors_with_sponsorship],
                    ["active", funnel.donors_with_active_sponsorship],
                  ] as const
                ).map(([key, count]) => (
                  <div className="sa-rank-row" key={key}>
                    <div className="sa-rank-head">
                      <span className="sa-rank-name">
                        {t(`platform.analytics.funnel.${key}`)}
                      </span>
                      <span className="sa-rank-value latin">{nfmt.format(count)}</span>
                    </div>
                    <div className="sa-rank-bar">
                      <div
                        className="sa-rank-bar-fill"
                        style={{
                          inlineSize: `${((count / funnel.registered_donors) * 100).toFixed(1)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GrowthChart({
  months,
  monthShort,
  title,
}: {
  months: PaymentsTimeseries["months"];
  monthShort: (d: Date) => string;
  title: string;
}) {
  const W = 900;
  const H = 240;
  const padTop = 20;
  const padBottom = 16;
  const vals = months.map((m) => Number(m.payments_total));
  const max = Math.max(...vals, 1);
  const n = months.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom);
  const linePts = vals.map((v, i) => `${x(i)},${y(v)}`);
  const linePath = `M${linePts.join(" L")}`;
  const areaPath = `M${x(0)},${H} L${linePts.join(" L")} L${x(n - 1)},${H} Z`;
  const lastVal = vals[n - 1] ?? 0;

  return (
    <>
      <div className="sa-growth-chart" dir="ltr" role="img" aria-label={title}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="sa-an-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#769FCD" stopOpacity=".35" />
              <stop offset="100%" stopColor="#769FCD" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="#E7EBEF" strokeWidth="1">
            {[0.2, 0.4, 0.6, 0.8].map((f) => {
              const gy = padTop + f * (H - padTop - padBottom);
              return <line key={f} x1="0" y1={gy} x2={W} y2={gy} />;
            })}
          </g>
          <path d={areaPath} fill="url(#sa-an-grad)" />
          <path
            d={linePath}
            stroke="#426D9F"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={x(n - 1)} cy={y(lastVal)} r="5" fill="#426D9F" stroke="white" strokeWidth="2" />
        </svg>
      </div>
      <div className="sa-chart-x-labels" dir="ltr" aria-hidden="true">
        {months.map((m, i) => (
          <span key={m.month} className={i === n - 1 ? "current" : undefined}>
            {monthShort(new Date(m.month))}
          </span>
        ))}
      </div>
    </>
  );
}

function BigStat({
  icon,
  label,
  value,
  explain,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  explain: string;
}) {
  return (
    <div className="sa-stat-big">
      <div className="sa-stat-big-label">
        <Icon className="sa-icon sa-icon-sm">{icon}</Icon>
        {label}
      </div>
      <div className="sa-stat-big-value latin">{value}</div>
      <div className="sa-stat-big-explain">{explain}</div>
    </div>
  );
}

function EmptyState({ title, body, icon }: { title: string; body?: string; icon: ReactNode }) {
  return (
    <div className="sa-empty">
      <Icon>{icon}</Icon>
      <div className="sa-empty-title">{title}</div>
      {body ? <div className="sa-empty-sub">{body}</div> : null}
    </div>
  );
}
