import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { listPlatformOrganizations } from "@/lib/platform";
import {
  fetchPlatformSummary,
  fetchPlatformTimeseries,
  type PaymentsTimeseries,
} from "@/lib/stats";

import "./PlatformDashboardPage.css";

/**
 * SA-01 — Platform Dashboard.
 *
 * Pixel-parity port of docs/design/screens/super-admin/SA-01-Dashboard.html.
 * The mockup's app-shell (dark sidebar + topbar) is provided by
 * PlatformLayout; this component renders only the content area.
 *
 * Wired to existing endpoints:
 *   - GET /stats/platform/summary       → KPI figures
 *   - GET /stats/platform/timeseries    → growth area chart
 *   - GET /platform/organizations       → pending count, country count,
 *                                          recent-activity list
 *
 * Inert / not-yet-sourced (TODO(backend)):
 *   - KPI trend badges (no period-over-period deltas exposed)
 *   - System Health panel (no infra metrics endpoint)
 *   - Export CSV button (no export endpoint)
 */

// ── Inline icon helper (mirrors DashboardPage pattern) ───────────────────
function Icon({
  children,
  className = "sa-icon sa-icon-sm",
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
  building: <path d="M3 21h18M5 21V7l7-4 7 4v14" />,
  heart: (
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ),
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  bars: (
    <>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
};

const PLACEHOLDER = "—";

function useFormatters() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    int: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
    compact: (n: number) =>
      n.toLocaleString(lang, { notation: "compact", maximumFractionDigits: 1 }),
    monthShort: (d: Date) => new Intl.DateTimeFormat(lang, { month: "short" }).format(d),
    relative: (iso: string) => relativeTime(iso, lang),
  };
}

// Coarse relative-time label, using the platform Intl.RelativeTimeFormat.
function relativeTime(iso: string, lang: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  return rtf.format(Math.round(diffSec / 2592000), "month");
}

type Fmt = ReturnType<typeof useFormatters>;

export function PlatformDashboardPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();

  const { data: summary } = useQuery({
    queryKey: ["platform", "summary"],
    queryFn: fetchPlatformSummary,
  });
  const { data: timeseries } = useQuery({
    queryKey: ["platform", "timeseries"],
    queryFn: fetchPlatformTimeseries,
  });
  const { data: orgs } = useQuery({
    queryKey: ["platform", "organizations", {}],
    queryFn: () => listPlatformOrganizations(),
  });

  const pendingCount = orgs
    ? orgs.filter((o) => o.status === "pending_approval").length
    : undefined;
  const countryCount = orgs
    ? new Set(orgs.map((o) => o.country_code)).size
    : undefined;
  const currency = summary?.total_donated_by_currency[0]?.currency ?? null;

  return (
    <div className="sa-dash">
      {/* Single semantic h1 — visually hidden because the visible page
          name lives in the topbar (an h2), matching the mockup. */}
      <h1 className="sr-only">{t("platform.dashboard.title")}</h1>

      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <div className="sa-topbar">
        <div className="sa-topbar-title">
          <h2>{t("platform.dashboard.headline")}</h2>
          <p>{t("platform.dashboard.subtitle")}</p>
        </div>
        <div className="sa-topbar-actions">
          {/* TODO(backend): no platform CSV export endpoint. */}
          <button
            type="button"
            className="sa-btn sa-btn-secondary"
            disabled
            aria-disabled="true"
          >
            <Icon>{ICONS.download}</Icon>
            {t("platform.dashboard.exportCsv")}
          </button>
          <Link to="/platform/organizations" className="sa-btn sa-btn-primary">
            <Icon>{ICONS.plus}</Icon>
            {t("platform.dashboard.newOrg")}
          </Link>
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────────────── */}
      <section className="sa-kpi-grid" aria-label={t("platform.dashboard.title")}>
        <KpiCard
          icon={ICONS.building}
          iconClass=""
          value={summary ? fmt.int(summary.active_orgs) : PLACEHOLDER}
          label={t("platform.dashboard.kpi.activeOrgs")}
          meta={
            pendingCount !== undefined
              ? t("platform.dashboard.kpi.pendingMeta", { count: pendingCount })
              : undefined
          }
        />
        <KpiCard
          icon={ICONS.heart}
          iconClass="green"
          value={summary ? fmt.int(summary.total_orphans) : PLACEHOLDER}
          label={t("platform.dashboard.kpi.totalOrphans")}
          meta={
            countryCount !== undefined
              ? t("platform.dashboard.kpi.countriesMeta", { count: countryCount })
              : undefined
          }
        />
        <KpiCard
          icon={ICONS.dollar}
          iconClass="gold"
          value={summary ? fmt.compact(Number(summary.total_donated_converted)) : PLACEHOLDER}
          unit={currency ?? undefined}
          label={t("platform.dashboard.kpi.totalDonated")}
          meta={t("platform.dashboard.kpi.donatedMeta")}
        />
        <KpiCard
          icon={ICONS.activity}
          iconClass="snow"
          /* TODO(backend): no uptime / infra-health metric is exposed. */
          value={PLACEHOLDER}
          label={t("platform.dashboard.kpi.uptime")}
          meta={t("platform.dashboard.kpi.uptimeMeta")}
        />
      </section>

      {/* ── Growth chart + System health ────────────────────────────── */}
      <div className="sa-grid-row">
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.bars}</Icon>
              {t("platform.dashboard.growth.title")}
            </div>
            <span className="sa-panel-meta">{t("platform.dashboard.growth.source")}</span>
          </div>
          <div className="sa-panel-body sa-chart-wrap">
            <div className="sa-chart-meta">
              <span className="sa-chart-meta-item">
                <span className="sa-chart-meta-dot" style={{ background: "var(--trust-500)" }} />
                {t("platform.dashboard.growth.legendDonations")}
              </span>
            </div>
            {!timeseries ? (
              <div className="sa-skeleton" style={{ height: 200 }} />
            ) : timeseries.months.length === 0 ? (
              <EmptyState
                title={t("platform.dashboard.growth.empty")}
                icon={ICONS.bars}
              />
            ) : (
              <GrowthChart timeseries={timeseries} fmt={fmt} title={t("platform.dashboard.growth.title")} />
            )}
          </div>
        </div>

        {/* System health — TODO(backend): no infra metrics endpoint. */}
        <div className="sa-panel">
          <div className="sa-panel-head">
            <div className="sa-panel-title">
              <Icon>{ICONS.activity}</Icon>
              {t("platform.dashboard.health.title")}
            </div>
          </div>
          <div className="sa-panel-body">
            <EmptyState
              title={t("platform.comingSoonTitle")}
              body={t("platform.comingSoonBody")}
              icon={ICONS.activity}
            />
          </div>
        </div>
      </div>

      {/* ── Recent activity (recently added organizations) ──────────── */}
      <div className="sa-panel">
        <div className="sa-panel-head">
          <div className="sa-panel-title">
            <Icon>{ICONS.clock}</Icon>
            {t("platform.dashboard.recent.title")}
          </div>
          <Link to="/platform/organizations" className="sa-panel-link">
            {t("platform.dashboard.recent.viewAll")}
          </Link>
        </div>
        <div className="sa-panel-body" style={{ paddingBlock: 0 }}>
          {!orgs ? (
            <div className="sa-skeleton" style={{ height: 120, margin: "20px 0" }} />
          ) : orgs.length === 0 ? (
            <EmptyState
              title={t("platform.dashboard.recent.empty")}
              icon={ICONS.inbox}
            />
          ) : (
            <div className="sa-activity-list">
              {orgs.slice(0, 8).map((org) => (
                <RecentRow key={org.id} org={org} fmt={fmt} />
              ))}
            </div>
          )}
        </div>
        {orgs && orgs.length > 0 && (
          <div className="sa-panel-footer">
            {t("platform.dashboard.recent.footer", { count: orgs.length })}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  iconClass,
  value,
  unit,
  label,
  meta,
}: {
  icon: ReactNode;
  iconClass: string;
  value: string;
  unit?: string;
  label: string;
  meta?: string;
}) {
  return (
    <article className="sa-kpi" aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <div className="sa-kpi-head">
        <div className={`sa-kpi-icon ${iconClass}`}>
          <Icon className="sa-icon">{icon}</Icon>
        </div>
      </div>
      <div className="sa-kpi-value">
        <span className="latin">{value}</span>
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="sa-kpi-label">{label}</div>
      {meta ? <div className="sa-kpi-meta">{meta}</div> : null}
    </article>
  );
}

// Area chart built from the real platform payments timeseries. Wrapped in
// a dir="ltr" container so time reads oldest→newest, consistent between
// the plotted line and the month labels.
function GrowthChart({
  timeseries,
  fmt,
  title,
}: {
  timeseries: PaymentsTimeseries;
  fmt: Fmt;
  title: string;
}) {
  const months = timeseries.months;
  const W = 600;
  const H = 160;
  const padTop = 20;
  const padBottom = 12;
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
      <div className="sa-area-chart" dir="ltr" role="img" aria-label={title}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="sa-grad-growth" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#769FCD" stopOpacity=".35" />
              <stop offset="100%" stopColor="#769FCD" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="#E7EBEF" strokeWidth="1">
            {[0.25, 0.5, 0.75].map((f) => {
              const gy = padTop + f * (H - padTop - padBottom);
              return <line key={f} x1="0" y1={gy} x2={W} y2={gy} />;
            })}
          </g>
          <path d={areaPath} fill="url(#sa-grad-growth)" />
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
            {fmt.monthShort(new Date(m.month))}
          </span>
        ))}
      </div>
    </>
  );
}

function RecentRow({
  org,
  fmt,
}: {
  org: { id: string; name_ar: string; name_en: string; code: string; status: string; created_at: string };
  fmt: Fmt;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const name = isAr ? org.name_ar : org.name_en;
  return (
    <Link to="/platform/organizations" className="sa-activity-row">
      <div className="sa-activity-dot create">
        <Icon>{ICONS.plus}</Icon>
      </div>
      <div className="sa-activity-body">
        <div className="sa-activity-text">
          <strong>{t("platform.dashboard.recent.added")}</strong> {name}
        </div>
        <div className="sa-activity-meta">
          <span className="mono">{org.code}</span> ·{" "}
          {t(`platform.orgStatus.${org.status}`, org.status)}
        </div>
      </div>
      <span className="sa-activity-time">{fmt.relative(org.created_at)}</span>
    </Link>
  );
}

function EmptyState({ title, body, icon }: { title: string; body?: string; icon: ReactNode }) {
  return (
    <div className="sa-empty">
      <Icon className="sa-icon">{icon}</Icon>
      <div className="sa-empty-title">{title}</div>
      {body ? <div className="sa-empty-sub">{body}</div> : null}
    </div>
  );
}
