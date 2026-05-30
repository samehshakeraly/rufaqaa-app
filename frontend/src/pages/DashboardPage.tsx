import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton, StatGridSkeleton } from "@/components/Skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchOrganization } from "@/lib/organization";
import {
  type DashboardSummary,
  type PaymentsTimeseries,
  fetchPaymentsTimeseries,
  fetchSummary,
} from "@/lib/stats";

import "./DashboardPage.css";

// ── Inline icon set (stroke icons, sized via .oa-icon utility) ──────────
function Icon({ children, className = "oa-icon oa-icon-sm" }: { children: ReactNode; className?: string }) {
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
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14 2 9.27l6.91-1.01L12 2z" />,
  zakat: <path d="M12 2v20M5 9c0-3 2-5 7-5s7 2 7 5-2 4-5 4h-4c-3 0-5 1-5 4s2 5 7 5 7-2 7-5" />,
  bars: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />
      <circle cx="12" cy="14" r="2" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8" r="6" />
      <polyline points="9 13 9 22 12 19 15 22 15 13" />
    </>
  ),
  mapPin: (
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  chevronStart: <polyline points="15 18 9 12 15 6" />,
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
};

// ── Formatting helpers ──────────────────────────────────────────────────
function useFormatters() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    int: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
    money: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
    compact: (n: number) =>
      n.toLocaleString(lang, { notation: "compact", maximumFractionDigits: 1 }),
    time: (ts: number) =>
      new Date(ts).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }),
    monthShort: (d: Date) => new Intl.DateTimeFormat(lang, { month: "short" }).format(d),
  };
}

const PLACEHOLDER = "—";

export function DashboardPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const { data: me } = useCurrentUser();

  const summaryQuery = useQuery({ queryKey: ["stats", "summary"], queryFn: fetchSummary });
  const timeseriesQuery = useQuery({
    queryKey: ["stats", "payments-timeseries"],
    queryFn: fetchPaymentsTimeseries,
  });
  const orgQuery = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });

  const summary = summaryQuery.data;
  const timeseries = timeseriesQuery.data;
  const currency = orgQuery.data?.default_currency ?? null;

  return (
    <div className="oa-dash">
      {/* ── Greeting (page h1) ─────────────────────────────────────── */}
      <div className="oa-greeting">
        <div className="oa-greeting-text">
          <h1>{t("dashboard.greeting", { name: me?.first_name ?? "" })}</h1>
          <p>{t("dashboard.greetingSubtitle")}</p>
        </div>
        {summaryQuery.dataUpdatedAt > 0 && (
          <div className="oa-greeting-meta">
            <span className="oa-live-dot" aria-hidden="true" />
            {t("dashboard.lastUpdated", { time: fmt.time(summaryQuery.dataUpdatedAt) })}
          </div>
        )}
      </div>

      {/* ── KPI row ────────────────────────────────────────────────── */}
      {!summary ? (
        <div style={{ marginBottom: 22 }}>
          <StatGridSkeleton cards={5} />
        </div>
      ) : (
        <KpiRow summary={summary} timeseries={timeseries} currency={currency} fmt={fmt} />
      )}

      {/* ── Revenue + Alerts ───────────────────────────────────────── */}
      <section className="oa-grid-main">
        <RevenueCard timeseries={timeseries} currency={currency} fmt={fmt} />
        <AlertsCard summary={summary} />
      </section>

      {/* ── Sponsorship movement + Top channels ────────────────────── */}
      <section className="oa-grid-half">
        <MovementCard />
        <ChannelsCard />
      </section>

      {/* ── Top donors + Geographic ────────────────────────────────── */}
      <section className="oa-grid-half">
        <TopDonorsCard />
        <GeoCard />
      </section>
    </div>
  );
}

type Fmt = ReturnType<typeof useFormatters>;

// ════════════════════════════════════════════════════════════════════
// KPI row
// ════════════════════════════════════════════════════════════════════
function KpiRow({
  summary,
  timeseries,
  currency,
  fmt,
}: {
  summary: DashboardSummary;
  timeseries: PaymentsTimeseries | undefined;
  currency: string | null;
  fmt: Fmt;
}) {
  const { t } = useTranslation();

  // Revenue spark: the last 8 months of real completed-payment totals.
  const spark = timeseries
    ? timeseries.months.slice(-8).map((m) => Number(m.payments_total))
    : [];

  return (
    <section className="oa-kpi-grid" aria-label={t("dashboard.title")}>
      {/* 1 — Monthly revenue (last 30d) */}
      <KpiCard
        label={t("dashboard.kpi.revenue")}
        valueText={fmt.money(Number(summary.payments_last_30d_total))}
        unit={currency ?? undefined}
        icon={ICONS.dollar}
        iconClass="green"
        spark={spark.length ? spark : undefined}
      />

      {/* 2 — Active sponsorships */}
      <KpiCard
        label={t("dashboard.kpi.activeSponsorships")}
        valueText={fmt.int(summary.sponsorships_active)}
        icon={ICONS.heart}
        bench={
          summary.sponsorships_overdue > 0 ? (
            <span className="warn">
              <span className="latin">{fmt.int(summary.sponsorships_overdue)}</span>{" "}
              {t("dashboard.sponsorshipsOverdue")}
            </span>
          ) : undefined
        }
      />

      {/* 3 — Active donors. TODO(backend): no "active" filter or retention
          rate is exposed; showing total donors from /stats/summary. */}
      <KpiCard
        label={t("dashboard.kpi.activeDonors")}
        valueText={fmt.int(summary.donors_total)}
        icon={ICONS.users}
        iconClass="purple"
      />

      {/* 4 — Registered orphans. TODO(backend): an exact "approved"
          case_status count isn't exposed; showing total managed orphans.
          "under review" (pending_review) count is not in the summary. */}
      <KpiCard
        label={t("dashboard.kpi.registeredOrphans")}
        valueText={fmt.int(summary.orphans_total)}
        icon={ICONS.star}
        iconClass="gold"
        bench={
          <>
            <span className="latin">{fmt.int(summary.orphans_available)}</span>{" "}
            {t("dashboard.kpi.availableForSponsorship")} ·{" "}
            <span className="warn">
              {PLACEHOLDER} {t("dashboard.kpi.underReview")}
            </span>
          </>
        }
      />

      {/* 5 — Zakat share of revenue. TODO(backend): no zakat breakdown of
          revenue is exposed by the stats API. */}
      <KpiCard
        label={t("dashboard.kpi.zakatRate")}
        valueText={PLACEHOLDER}
        icon={ICONS.zakat}
        iconClass="warn"
      />
    </section>
  );
}

function KpiCard({
  label,
  valueText,
  unit,
  icon,
  iconClass = "",
  spark,
  bench,
}: {
  label: string;
  valueText: string;
  unit?: string;
  icon: ReactNode;
  iconClass?: string;
  spark?: number[];
  bench?: ReactNode;
}) {
  const ariaLabel = `${label}: ${valueText}${unit ? ` ${unit}` : ""}`;
  return (
    <article className="oa-kpi" aria-label={ariaLabel}>
      <div className="oa-kpi-top">
        <div>
          <div className="oa-kpi-label">{label}</div>
          <div className="oa-kpi-value">
            <span className="latin">{valueText}</span>
            {unit ? <span className="unit">{unit}</span> : null}
          </div>
        </div>
        <div className={`oa-kpi-icon-bg ${iconClass}`}>
          <Icon>{icon}</Icon>
        </div>
      </div>
      <Spark values={spark} />
      {bench ? <div className="oa-kpi-bench">{bench}</div> : null}
    </article>
  );
}

// Mini bar sparkline. With real `values` the last bar is highlighted;
// without a data source it renders a muted placeholder track (decorative,
// aria-hidden) so the card keeps its rhythm without asserting fake data.
function Spark({ values }: { values?: number[] }) {
  if (!values || values.length === 0) {
    return (
      <div className="oa-kpi-spark placeholder" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="oa-kpi-spark-bar" style={{ height: "32%" }} />
        ))}
      </div>
    );
  }
  const max = Math.max(...values, 1);
  return (
    <div className="oa-kpi-spark" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className={`oa-kpi-spark-bar${i === values.length - 1 ? " lit" : ""}`}
          style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Revenue card
// ════════════════════════════════════════════════════════════════════
function RevenueCard({
  timeseries,
  currency,
  fmt,
}: {
  timeseries: PaymentsTimeseries | undefined;
  currency: string | null;
  fmt: Fmt;
}) {
  const { t } = useTranslation();
  const months = timeseries?.months ?? [];
  const totals = months.map((m) => Number(m.payments_total));
  const yearTotal = totals.reduce((a, b) => a + b, 0);
  const monthlyAvg = months.length ? yearTotal / months.length : 0;

  return (
    <div className="oa-card">
      <div className="oa-card-head">
        <h2>
          <Icon>{ICONS.trendingUp}</Icon>
          {t("dashboard.revenue.title")}
        </h2>
      </div>
      <div className="oa-card-body">
        <div className="oa-chart-legend">
          <span className="oa-chart-legend-item">
            <span className="oa-chart-legend-dot actual" />
            {t("dashboard.revenue.legendActual")}
          </span>
          {/* TODO(backend): no zakat / monthly-target series in the stats
              API — legend entries shown muted, no line plotted. */}
          <span className="oa-chart-legend-item muted">
            <span className="oa-chart-legend-dot zakat" />
            {t("dashboard.revenue.legendZakat")}
          </span>
          <span className="oa-chart-legend-item muted">
            <span className="oa-chart-legend-dot target" />
            {t("dashboard.revenue.legendTarget")}
          </span>
        </div>

        {!timeseries ? (
          <Skeleton className="h-[220px] w-full" />
        ) : months.length === 0 ? (
          <EmptyState
            title={t("dashboard.revenue.empty")}
            icon={ICONS.trendingUp}
            body=""
          />
        ) : (
          <RevenueAreaChart months={months} fmt={fmt} />
        )}

        <div className="oa-rev-summary">
          <div>
            <div className="oa-rev-cell-label">{t("dashboard.revenue.yearTotal")}</div>
            <div className="oa-rev-cell-value">
              <span className="latin">{fmt.money(yearTotal)}</span>{" "}
              {currency ? <span className="unit">{currency}</span> : null}
            </div>
          </div>
          <div>
            <div className="oa-rev-cell-label">{t("dashboard.revenue.monthlyAvg")}</div>
            <div className="oa-rev-cell-value">
              <span className="latin">{fmt.money(monthlyAvg)}</span>{" "}
              {currency ? <span className="unit">{currency}</span> : null}
            </div>
          </div>
          {/* TODO(backend): no Ramadan-scoped revenue aggregation exposed. */}
          <div>
            <div className="oa-rev-cell-label">{t("dashboard.revenue.fromRamadan")}</div>
            <div className="oa-rev-cell-value">
              <span className="latin">{PLACEHOLDER}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// SVG area chart built from the real payments timeseries. Wrapped in a
// dir="ltr" container so time always reads oldest→newest left→right,
// consistent between the plotted line and the month labels.
function RevenueAreaChart({
  months,
  fmt,
}: {
  months: PaymentsTimeseries["months"];
  fmt: Fmt;
}) {
  const { t } = useTranslation();
  const W = 720;
  const H = 220;
  const padTop = 22;
  const padBottom = 8;
  const vals = months.map((m) => Number(m.payments_total));
  const max = Math.max(...vals, 1);
  const n = months.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom);

  const linePts = vals.map((v, i) => `${x(i)},${y(v)}`);
  const linePath = `M${linePts.join(" L")}`;
  const areaPath = `M${x(0)},${H} L${linePts.join(" L")} L${x(n - 1)},${H} Z`;
  const lastVal = vals[n - 1] ?? 0;
  const gridFractions = [0.25, 0.5, 0.75, 1];

  return (
    <>
      <div className="oa-area-chart" dir="ltr" role="img" aria-label={t("dashboard.revenue.title")}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="oa-grad-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5B85B8" stopOpacity=".25" />
              <stop offset="100%" stopColor="#5B85B8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="#E7EBEF" strokeWidth="1">
            {gridFractions.map((f) => {
              const gy = padTop + f * (H - padTop - padBottom);
              return <line key={f} x1="0" y1={gy} x2={W} y2={gy} />;
            })}
          </g>
          <g fill="#7A8590" fontSize="10" fontFamily="IBM Plex Sans">
            {gridFractions.map((f) => {
              const gy = padTop + f * (H - padTop - padBottom);
              const val = max * (1 - f);
              return (
                <text key={f} x={W} y={gy - 4} textAnchor="end">
                  {fmt.compact(val)}
                </text>
              );
            })}
          </g>
          <path d={areaPath} fill="url(#oa-grad-rev)" />
          <path
            d={linePath}
            stroke="#5B85B8"
            strokeWidth="2.2"
            fill="none"
            strokeLinejoin="round"
          />
          <circle cx={x(n - 1)} cy={y(lastVal)} r="5" fill="#5B85B8" stroke="white" strokeWidth="2" />
        </svg>
      </div>
      <div className="oa-chart-x-labels" dir="ltr" aria-hidden="true">
        {months.map((m, i) => (
          <span key={m.month} className={i === n - 1 ? "current" : undefined}>
            {fmt.monthShort(new Date(m.month))}
          </span>
        ))}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Alerts card
// ════════════════════════════════════════════════════════════════════
function AlertsCard({ summary }: { summary: DashboardSummary | undefined }) {
  const { t } = useTranslation();
  // The only alert we can source today is the overdue-sponsorship count.
  // TODO(backend): late partner reports, pending bank transfers, expiring
  // sponsorships and non-renewing donors have no stats endpoint yet.
  const overdue = summary?.sponsorships_overdue ?? 0;
  const alertCount = overdue > 0 ? 1 : 0;

  return (
    <div className="oa-card">
      <div className="oa-card-head">
        <h2>
          <Icon>{ICONS.alert}</Icon>
          {t("dashboard.alerts.title")}
        </h2>
        <span className="oa-head-meta">
          {summary ? t("dashboard.alerts.count", { count: alertCount }) : PLACEHOLDER}
        </span>
      </div>

      {alertCount > 0 ? (
        <div className="oa-alert-list">
          <Link to="/admin/sponsorships?status=overdue" className="oa-alert-row">
            <div className="oa-alert-icon amber">
              <Icon>{ICONS.clock}</Icon>
            </div>
            <div className="oa-alert-body">
              <div className="title">
                {t("dashboard.alerts.overdueTitle", { count: overdue })}
              </div>
              <div className="meta">{t("dashboard.alerts.overdueMeta")}</div>
            </div>
            <span className="oa-alert-cta">
              {t("dashboard.alerts.review")}
              <Icon>{ICONS.chevronStart}</Icon>
            </span>
          </Link>
        </div>
      ) : (
        <EmptyState
          title={summary ? t("dashboard.alerts.empty") : t("dashboard.comingSoonTitle")}
          body={t("dashboard.comingSoonBody")}
          icon={ICONS.inbox}
        />
      )}

      <div className="oa-card-foot">
        <span>{t("dashboard.alerts.criticalOnly")}</span>
        <Link to="/admin/sponsorships" className="oa-btn-ghost">
          {t("dashboard.alerts.viewAll")}
          <Icon>{ICONS.chevronStart}</Icon>
        </Link>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Placeholder cards (no backend source yet)
// ════════════════════════════════════════════════════════════════════
// TODO(backend): no monthly new/renewal/cancellation breakdown endpoint.
function MovementCard() {
  const { t } = useTranslation();
  return (
    <div className="oa-card">
      <div className="oa-card-head">
        <h2>
          <Icon>{ICONS.bars}</Icon>
          {t("dashboard.movement.title")}
        </h2>
      </div>
      <div className="oa-card-body">
        <div className="oa-chart-legend">
          <span className="oa-chart-legend-item">
            <span className="oa-chart-legend-dot" style={{ background: "var(--trust-400)" }} />
            {t("dashboard.movement.new")}
          </span>
          <span className="oa-chart-legend-item">
            <span
              className="oa-chart-legend-dot"
              style={{ background: "var(--success-500)", opacity: 0.85 }}
            />
            {t("dashboard.movement.renewals")}
          </span>
          <span className="oa-chart-legend-item">
            <span className="oa-chart-legend-dot" style={{ background: "var(--gray-300)" }} />
            {t("dashboard.movement.cancellations")}
          </span>
        </div>
        <EmptyState
          title={t("dashboard.comingSoonTitle")}
          body={t("dashboard.comingSoonBody")}
          icon={ICONS.bars}
        />
      </div>
    </div>
  );
}

// TODO(backend): no marketing-channel ranking endpoint in the stats API.
function ChannelsCard() {
  const { t } = useTranslation();
  return (
    <div className="oa-card">
      <div className="oa-card-head">
        <h2>
          <Icon>{ICONS.megaphone}</Icon>
          {t("dashboard.channels.title")}
        </h2>
        <span className="oa-head-meta">{t("dashboard.channels.meta")}</span>
      </div>
      <EmptyState
        title={t("dashboard.comingSoonTitle")}
        body={t("dashboard.comingSoonBody")}
        icon={ICONS.megaphone}
      />
      <div className="oa-card-foot">
        <span />
        <Link to="/admin/marketing-channels" className="oa-btn-ghost">
          {t("dashboard.channels.manage")}
          <Icon>{ICONS.chevronStart}</Icon>
        </Link>
      </div>
    </div>
  );
}

// TODO(backend): no top-donors ranking endpoint in the stats API.
function TopDonorsCard() {
  const { t } = useTranslation();
  return (
    <div className="oa-card">
      <div className="oa-card-head">
        <h2>
          <Icon>{ICONS.award}</Icon>
          {t("dashboard.topDonors.title")}
        </h2>
        <span className="oa-head-meta">{t("dashboard.topDonors.meta")}</span>
      </div>
      <EmptyState
        title={t("dashboard.comingSoonTitle")}
        body={t("dashboard.comingSoonBody")}
        icon={ICONS.award}
      />
      <div className="oa-card-foot">
        <span />
        <Link to="/admin/donors" className="oa-btn-ghost">
          {t("dashboard.topDonors.viewAll")}
          <Icon>{ICONS.chevronStart}</Icon>
        </Link>
      </div>
    </div>
  );
}

// TODO(backend): no orphans-by-country aggregation endpoint in the stats API.
function GeoCard() {
  const { t } = useTranslation();
  return (
    <div className="oa-card">
      <div className="oa-card-head">
        <h2>
          <Icon>{ICONS.mapPin}</Icon>
          {t("dashboard.geo.title")}
        </h2>
        <span className="oa-head-meta">{t("dashboard.geo.meta")}</span>
      </div>
      <EmptyState
        title={t("dashboard.comingSoonTitle")}
        body={t("dashboard.comingSoonBody")}
        icon={ICONS.mapPin}
      />
    </div>
  );
}

function EmptyState({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
  return (
    <div className="oa-empty">
      <Icon className="oa-icon">{icon}</Icon>
      <div className="oa-empty-title">{title}</div>
      {body ? <div className="oa-empty-sub">{body}</div> : null}
    </div>
  );
}
