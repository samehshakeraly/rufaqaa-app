import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SeoHead } from "@/components/public/SeoHead";
import {
  ArrowEndIcon,
  BarChartIcon,
  CheckIcon,
  CheckCircleIcon,
  ClockIcon,
  CodeIcon,
  CreditCardIcon,
  DollarIcon,
  GithubIcon,
  HeartIcon,
  NetworkIcon,
  StarIcon,
  UsersIcon,
} from "@/components/public/icons";
import { getPublicStats } from "@/lib/public";

import "./TransparencyPage.css";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";

/** No financial / row-level data is exposed by /public/stats, so every
 *  monetary or unbacked figure renders as this honest placeholder. */
const PLACEHOLDER = "—";

/**
 * W-04 — Transparency (/transparency). Pixel-matches the W-04 mockup,
 * mirroring the OA-01 scoped-CSS pattern: all body sections are ported
 * under the `.tr-root` scope; the shared nav/footer come from
 * PublicSiteLayout and are NOT duplicated here.
 *
 * Data wiring: GET /public/stats is the ONLY data source, and it returns
 * platform aggregates only — never money or row-level transactions. So:
 *   • Active sponsorships  ← stats.orphans_sponsored (real)
 *   • Everything financial (monthly donations, transfer ratio, average
 *     sponsorship duration, per-year report figures) and the live
 *     transfer feed and open-source repo metrics have NO backing
 *     endpoint → rendered as "—" placeholders with TODO(backend). We
 *     never fabricate financial numbers or transactions.
 *
 * The 95/3/2 allocation split is a stated, design-system policy (not a
 * computed figure), so it is shown as written in the mockup.
 */
export function TransparencyPage() {
  const { t, i18n } = useTranslation();
  const statsQ = useQuery({ queryKey: ["public", "stats"], queryFn: getPublicStats });

  // Locale-aware integer formatting with tabular figures (the .tr-latin /
  // unit spans carry the IBM Plex tnum styling).
  const int = (v: number | undefined) =>
    v === undefined ? PLACEHOLDER : v.toLocaleString(i18n.language, { maximumFractionDigits: 0 });

  // 95 / 3 / 2 split — stated policy, design-system token colours only.
  const allocation = [
    { label: "toOrphans", pct: 95, swatch: "tr-sw-1", stroke: "var(--trust-300)" },
    { label: "operations", pct: 3, swatch: "tr-sw-2", stroke: "var(--sky-300)" },
    { label: "reserves", pct: 2, swatch: "tr-sw-3", stroke: "var(--tranquil-300)" },
  ] as const;

  const commitments = [
    { tt: "c1Title", d: "c1Desc", Icon: CheckCircleIcon },
    { tt: "c2Title", d: "c2Desc", Icon: CodeIcon },
    { tt: "c3Title", d: "c3Desc", Icon: CheckCircleIcon },
  ] as const;

  // Open-source repo metrics have no backing endpoint — honest placeholders.
  // TODO(backend): expose GitHub repo stats (stars/forks/contributors/commits).
  const osStats = ["stars", "forks", "contributors", "commits"] as const;
  const osIcons: Record<(typeof osStats)[number], ReactNode> = {
    stars: <StarIcon className="tr-icon tr-icon-sm" />,
    forks: <NetworkIcon className="tr-icon tr-icon-sm" />,
    contributors: <UsersIcon className="tr-icon tr-icon-sm" />,
    commits: <BarChartIcon className="tr-icon tr-icon-sm" />,
  };

  return (
    <div className="tr-root">
      <SeoHead
        titleKey="public.transparency.meta.title"
        descriptionKey="public.transparency.meta.description"
      />

      {/* ── HERO ── */}
      <section className="tr-hero" aria-labelledby="tr-hero-title">
        <div className="tr-container tr-hero-inner">
          <span className="tr-eyebrow">
            <span className="tr-dot" aria-hidden="true" />
            {t("public.transparency.hero.eyebrow")}
          </span>
          <h1 className="tr-hero-title" id="tr-hero-title">
            {t("public.transparency.hero.title")}{" "}
            <span className="tr-accent">{t("public.transparency.hero.titleAccent")}</span>
          </h1>
          <p className="tr-hero-sub">{t("public.transparency.hero.subtitle")}</p>
          <div className="tr-last-updated">
            <span className="tr-pulse-dot" aria-hidden="true" />
            {t("public.transparency.hero.live")}
          </div>
        </div>
      </section>

      {/* ── REAL-TIME KPIs ── */}
      <section className="tr-kpi" aria-labelledby="tr-kpi-title">
        <h2 id="tr-kpi-title" className="tr-sr-only">
          {t("public.transparency.kpi.heading")}
        </h2>
        <div className="tr-container">
          <div className="tr-kpi-grid">
            {/* 1 — Donations this month. TODO(backend): no public revenue
                aggregate is exposed by /public/stats. */}
            <KpiCard
              icon={<DollarIcon className="tr-icon" />}
              value={PLACEHOLDER}
              label={t("public.transparency.kpi.donationsMonth")}
              meta={t("public.transparency.kpi.donationsMonthMeta")}
            />
            {/* 2 — Active sponsorships (real). */}
            <KpiCard
              icon={<HeartIcon className="tr-icon" />}
              value={int(statsQ.data?.orphans_sponsored)}
              loading={statsQ.isLoading}
              label={t("public.transparency.kpi.sponsored")}
              meta={t("public.transparency.kpi.sponsoredMeta")}
            />
            {/* 3 — Average sponsorship duration. TODO(backend): no duration
                aggregate is exposed by /public/stats. */}
            <KpiCard
              icon={<ClockIcon className="tr-icon" />}
              value={PLACEHOLDER}
              label={t("public.transparency.kpi.avgDuration")}
              meta={t("public.transparency.kpi.avgDurationMeta")}
            />
            {/* 4 — Share transferred to orphans. TODO(backend): no
                fee/transfer-ratio aggregate is exposed by /public/stats. */}
            <KpiCard
              icon={<CheckIcon className="tr-icon" />}
              value={PLACEHOLDER}
              label={t("public.transparency.kpi.transferRatio")}
              meta={t("public.transparency.kpi.transferRatioMeta")}
            />
          </div>
        </div>
      </section>

      {/* ── MAIN GRID: feed + allocation ── */}
      <section className="tr-main-grid-section" aria-labelledby="tr-feed-title">
        <div className="tr-container">
          <div className="tr-main-grid">
            {/* Transfer feed — honest placeholder, never fabricated.
                TODO(backend): wire to a future public "recent transfers"
                endpoint. /public/stats exposes aggregates only — never
                row-level transactions. */}
            <div>
              <div className="tr-feed-card">
                <div className="tr-feed-head">
                  <span className="tr-feed-title">
                    <CreditCardIcon className="tr-icon tr-icon-sm" />
                    <h2 id="tr-feed-title" style={{ font: "inherit" }}>
                      {t("public.transparency.feed.title")}
                    </h2>
                  </span>
                  <span className="tr-feed-live">
                    <span className="tr-pulse" aria-hidden="true" />
                    {t("public.transparency.feed.live")}
                  </span>
                </div>
                <div className="tr-feed-empty">
                  <CreditCardIcon className="tr-icon tr-icon-lg" />
                  <p>{t("public.transparency.feed.empty")}</p>
                </div>
                <div className="tr-feed-footer">{t("public.transparency.feed.footer")}</div>
              </div>
            </div>

            {/* Allocation donut — stated 95/3/2 policy. */}
            <aside>
              <div className="tr-alloc-card">
                <div className="tr-alloc-head">
                  <span className="tr-alloc-title">
                    <BarChartIcon className="tr-icon tr-icon-sm" />
                    {t("public.transparency.alloc.title")}
                  </span>
                  <span className="tr-alloc-period">{t("public.transparency.alloc.period")}</span>
                </div>

                <div className="tr-donut">
                  <svg
                    viewBox="0 0 36 36"
                    role="img"
                    aria-label={`${t("public.transparency.alloc.title")}: ${allocation
                      .map((s) => `${t(`public.transparency.alloc.${s.label}`)} ${s.pct}%`)
                      .join(", ")}`}
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="15.915"
                      fill="none"
                      stroke="var(--tranquil-100)"
                      strokeWidth="3.6"
                    />
                    {(() => {
                      let offset = 0;
                      return allocation.map((seg) => {
                        const el = (
                          <circle
                            key={seg.label}
                            cx="18"
                            cy="18"
                            r="15.915"
                            fill="none"
                            stroke={seg.stroke}
                            strokeWidth="3.6"
                            strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                            strokeDashoffset={-offset}
                          />
                        );
                        offset += seg.pct;
                        return el;
                      });
                    })()}
                  </svg>
                  <div className="tr-donut-center" aria-hidden="true">
                    <div className="tr-donut-center-num tr-latin">
                      95<span className="tr-pct">%</span>
                    </div>
                    <div className="tr-donut-center-label">
                      {t("public.transparency.alloc.centerLabel")}
                    </div>
                  </div>
                </div>

                <div className="tr-alloc-legend">
                  {allocation.map((seg) => (
                    <div key={seg.label} className="tr-legend-row">
                      <span className={`tr-legend-swatch ${seg.swatch}`} aria-hidden="true" />
                      <span className="tr-legend-label">
                        {t(`public.transparency.alloc.${seg.label}`)}
                      </span>
                      <span className="tr-legend-value tr-latin">{seg.pct}%</span>
                    </div>
                  ))}
                </div>

                <p className="tr-alloc-footer">{t("public.transparency.alloc.footer")}</p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* ── ANNUAL REPORTS ── */}
      <section className="tr-reports" aria-labelledby="tr-reports-title">
        <div className="tr-container">
          <div className="tr-section-head-center">
            <span className="tr-eyebrow">{t("public.transparency.reports.eyebrow")}</span>
            <h2 className="tr-section-title" id="tr-reports-title">
              {t("public.transparency.reports.title")}{" "}
              <span className="tr-accent-color">
                {t("public.transparency.reports.titleAccent")}
              </span>
            </h2>
            <p className="tr-section-lede">{t("public.transparency.reports.lede")}</p>
          </div>

          <div className="tr-reports-grid">
            {[2023, 2024, 2025].map((year) => (
              <article key={year} className="tr-report-card">
                <div className="tr-report-head">
                  <div className="tr-report-year">{year}</div>
                  <span className="tr-report-status tr-upcoming">
                    {t("public.transparency.reports.pending")}
                  </span>
                </div>
                {/* TODO(backend): no per-year audited financial figures are
                    exposed by /public/stats — figures shown as placeholders. */}
                <div className="tr-report-figures">
                  <div>
                    <div className="tr-report-figure-label">
                      {t("public.transparency.reports.figureDonations")}
                    </div>
                    <div className="tr-report-figure-value tr-latin">{PLACEHOLDER}</div>
                  </div>
                  <div>
                    <div className="tr-report-figure-label">
                      {t("public.transparency.reports.figureSponsored")}
                    </div>
                    <div className="tr-report-figure-value tr-latin">{PLACEHOLDER}</div>
                  </div>
                </div>
                <p className="tr-report-note">{t("public.transparency.reports.pendingNote")}</p>
                <div className="tr-report-actions">
                  <span className="tr-report-btn" aria-disabled="true">
                    <ClockIcon className="tr-icon tr-icon-sm" />
                    {t("public.transparency.reports.soon")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── INDEPENDENT AUDITOR ── */}
      <section className="tr-auditor" aria-labelledby="tr-auditor-title">
        <div className="tr-container">
          <div className="tr-section-head-center">
            <span className="tr-eyebrow">{t("public.transparency.auditor.eyebrow")}</span>
            <h2 className="tr-section-title" id="tr-auditor-title">
              {t("public.transparency.auditor.title")}{" "}
              <span className="tr-accent-color">
                {t("public.transparency.auditor.titleAccent")}
              </span>
            </h2>
          </div>

          {/* TODO(backend): the audit firm identity / licence are not exposed
              by any endpoint and we don't fabricate a real org name. */}
          <article className="tr-auditor-card">
            <div className="tr-auditor-logo" aria-hidden="true">
              {PLACEHOLDER}
            </div>
            <div>
              <div className="tr-auditor-label">{t("public.transparency.auditor.label")}</div>
              <div className="tr-auditor-name">{t("public.transparency.auditor.namePending")}</div>
              <p className="tr-auditor-cert">{t("public.transparency.auditor.cert")}</p>
              <div className="tr-auditor-tags">
                <span className="tr-auditor-tag">
                  <CheckIcon className="tr-icon tr-icon-sm" />
                  {t("public.transparency.auditor.tagIndependent")}
                </span>
                <span className="tr-auditor-tag">
                  <CheckIcon className="tr-icon tr-icon-sm" />
                  {t("public.transparency.auditor.tagStandards")}
                </span>
                <span className="tr-auditor-tag">
                  <CheckIcon className="tr-icon tr-icon-sm" />
                  {t("public.transparency.auditor.tagAnnual")}
                </span>
              </div>
            </div>
            <span className="tr-btn tr-btn-secondary tr-btn-lg" aria-disabled="true">
              {t("public.transparency.auditor.cta")}
              <ArrowEndIcon className="tr-icon tr-icon-sm" />
            </span>
          </article>
        </div>
      </section>

      {/* ── COMMITMENTS (sr-only group; rendered as auditor tags above are
          policy; the three commitments back the headline claims) ── */}
      <h2 className="tr-sr-only">{t("public.transparency.commitments.title")}</h2>
      <ul className="tr-sr-only">
        {commitments.map(({ tt, d }) => (
          <li key={tt}>
            {t(`public.transparency.commitments.${tt}`)}: {t(`public.transparency.commitments.${d}`)}
          </li>
        ))}
      </ul>

      {/* ── OPEN SOURCE STRIP ── */}
      <section className="tr-osstrip" aria-labelledby="tr-os-title">
        <div className="tr-container">
          <div className="tr-osstrip-card">
            <div className="tr-osstrip-grid">
              <div className="tr-osstrip-head">
                <span className="tr-osstrip-eyebrow">
                  <CodeIcon className="tr-icon tr-icon-sm" />
                  {t("public.transparency.os.eyebrow")}
                </span>
                <h2 className="tr-osstrip-title" id="tr-os-title">
                  {t("public.transparency.os.title")}
                </h2>
                <p className="tr-osstrip-sub">{t("public.transparency.os.subtitle")}</p>
                <div className="tr-osstrip-cta">
                  <a
                    className="tr-btn-os-primary"
                    href={REPO_URL}
                    rel="noopener"
                    target="_blank"
                  >
                    <GithubIcon className="tr-icon tr-icon-sm" />
                    {t("public.transparency.os.repoButton")}
                  </a>
                  <a
                    className="tr-btn-os-outline"
                    href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}
                    rel="noopener"
                    target="_blank"
                  >
                    {t("public.transparency.os.contributing")}
                    <ArrowEndIcon className="tr-icon tr-icon-sm" />
                  </a>
                </div>
              </div>

              {/* TODO(backend): no live GitHub repo metrics endpoint —
                  honest placeholders, never fabricated counts. */}
              <div className="tr-osstrip-stats">
                {osStats.map((s) => (
                  <div key={s} className="tr-osstat">
                    <div className="tr-osstat-icon">{osIcons[s]}</div>
                    <div className="tr-osstat-value tr-latin">{PLACEHOLDER}</div>
                    <div className="tr-osstat-label">{t(`public.transparency.os.${s}`)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="tr-sr-only">{t("public.transparency.feed.todo")}</p>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  icon,
  value,
  label,
  meta,
  loading,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  meta: string;
  loading?: boolean;
}) {
  return (
    <div className="tr-kpi-card" aria-label={`${label}: ${loading ? "…" : value}`}>
      <div className="tr-kpi-head">
        <div className="tr-kpi-icon">{icon}</div>
      </div>
      <div className="tr-kpi-value tr-latin">{loading ? "…" : value}</div>
      <div className="tr-kpi-label">{label}</div>
      <div className="tr-kpi-meta">{meta}</div>
    </div>
  );
}
