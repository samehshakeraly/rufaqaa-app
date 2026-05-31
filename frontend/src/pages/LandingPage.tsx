import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  ArrowEndIcon,
  BarChartIcon,
  CheckCircleIcon,
  CheckIcon,
  CodeIcon,
  GlobeIcon,
  HeartIcon,
  InfoIcon,
  LockIcon,
  SearchIcon,
} from "@/components/public/icons";
import { useRole } from "@/hooks/useRole";
import { getPublicStats } from "@/lib/public";
import { isTokenValid, useAuthStore } from "@/store/auth";

import "./LandingPage.css";

const PLACEHOLDER = "—";

// Home paths that are actually mounted in the router (see App.tsx). The
// logged-in dispatch below redirects ONLY to one of these. This guards
// against ever sending a user to a not-yet-built portal (e.g. /guardian),
// which would bounce off the catch-all `<Route path="*">` back to "/" and
// create an infinite <Navigate> loop ("Maximum update depth exceeded").
const KNOWN_HOME_PATHS = new Set([
  "/platform",
  "/admin/dashboard",
  "/partner/approvals",
  "/admin/orphans",
  "/admin/finance",
  "/admin/marketing-channels",
  "/donor/dashboard",
  "/orphan",
]);

// Locale-aware number formatting (tabular figures rendered via the
// `.latin` helper). Mirrors DashboardPage's useFormatters.
function useFormatNumber() {
  const { i18n } = useTranslation();
  return (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 0 });
}

// ── Local inline icons not present in components/public/icons.tsx ────────
// Lightning/activity icon for the "how it works" eyebrow.
function ActivityIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
// Building/columns icon for the partners eyebrow.
function BankIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className}>
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
    </svg>
  );
}

/**
 * W-01 — public landing for anonymous visitors (`/`). Pixel-matched to
 * docs/design/screens/public/W-01-LandingPage.html, ported under the
 * scoped `.lp-root` class (mirrors the OA-01 DashboardPage pattern).
 *
 * Rendered inside PublicSiteLayout, which already provides the shared
 * PublicNav + PublicFooter — only the page body sections are ported.
 *
 * Logged-in users get dispatched to their home area on first paint so
 * the landing isn't shown to people who already have a relationship
 * with the platform.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const fmt = useFormatNumber();
  const token = useAuthStore((s) => s.accessToken);
  const { role, homePath } = useRole();
  const statsQ = useQuery({
    queryKey: ["public", "stats"],
    queryFn: getPublicStats,
  });

  // Authenticated visitors: send them to their area as soon as role is
  // known. We can't redirect before /me resolves because we don't know
  // the role yet — render the landing in the meantime. We only dispatch
  // to a route we know is mounted; roles without a portal yet (e.g.
  // guardian) fall through and stay on the landing rather than looping.
  // Only an unexpired token drives the dispatch — a stale/expired token
  // must never trigger a redirect (it would loop against the login guard).
  if (isTokenValid(token) && role !== undefined && KNOWN_HOME_PATHS.has(homePath)) {
    return <Navigate to={homePath} replace />;
  }

  const stats = statsQ.data;
  const numOrNa = (n: number | undefined) => (n === undefined ? PLACEHOLDER : fmt(n));

  return (
    <div className="lp-root">
      <SeoHead titleKey="landing.meta.title" descriptionKey="landing.meta.description" />

      {/* ═══ HERO ═══ */}
      <section className="lp-hero" aria-labelledby="lp-hero-title">
        <div className="lp-container lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="dot" aria-hidden="true" />
              {t("landing.hero.eyebrow")}
            </span>

            {/* The single semantic <h1> on the page. Keeps the "Sponsor"/
                "اكفل" hero heading for the e2e smoke test. */}
            <h1 className="lp-hero-title" id="lp-hero-title">
              {t("landing.hero.title")} <span className="accent">{t("landing.hero.titleAccent")}</span>
              <span className="pbuh latin" aria-hidden="true">
                {"ﷺ"}
              </span>
            </h1>

            <p className="lp-hero-sub">{t("landing.hero.subtitle")}</p>

            <div className="lp-hero-cta-row">
              <Link className="lp-btn lp-btn-primary lp-btn-xl" to="/orphans">
                <SearchIcon className="lp-icon" />
                {t("landing.hero.browse")}
              </Link>
              <Link className="lp-btn lp-btn-secondary lp-btn-xl" to="/signup">
                {t("landing.hero.signup")}
                <ArrowEndIcon className="lp-icon lp-arrow-end" />
              </Link>
            </div>

            <div className="lp-hero-trust-row">
              <span className="trust-item">
                <ShieldSmall />
                {t("landing.hero.trustPayments")}
              </span>
              <span className="sep" aria-hidden="true" />
              <span className="trust-item">
                <CheckIcon className="lp-icon lp-icon-sm" />
                {t("landing.hero.trustAudit")}
              </span>
              <span className="sep" aria-hidden="true" />
              <span className="trust-item">
                <GlobeIcon className="lp-icon lp-icon-sm" />
                {/* Countries served — sourced from /public/stats. */}
                {t("landing.hero.trustCountries", { count: stats?.countries_served ?? 0 })}
              </span>
            </div>
          </div>

          <HeroArt />
        </div>
      </section>

      {/* ═══ LIVE STATS ═══ */}
      <section className="lp-stats" aria-labelledby="lp-stats-title">
        <h2 id="lp-stats-title" className="sr-only">
          {t("landing.stats.srTitle")}
        </h2>
        <div className="lp-container">
          <div className="lp-stats-pulse">
            <span className="lp-stats-pulse-dot" aria-hidden="true" />
            <span>{t("landing.stats.pulse")}</span>
          </div>

          <div className="lp-stats-inner">
            <Stat
              value={numOrNa(stats?.orphans_sponsored)}
              label={t("landing.stats.sponsoredLabel")}
              // TODO(backend): no partner-organization count exposed by
              // /public/stats — meta figure rendered as a placeholder.
              meta={t("landing.stats.sponsoredMeta", { count: PLACEHOLDER })}
            />
            <Stat
              // TODO(backend): /public/stats exposes total donors, not an
              // "active sponsor" segment; using donors_total as the closest.
              value={numOrNa(stats?.donors_total)}
              label={t("landing.stats.donorsLabel")}
              // TODO(backend): no "joined this month" figure exposed.
              meta={t("landing.stats.donorsMeta", { count: PLACEHOLDER })}
            />
            <Stat
              value={numOrNa(stats?.countries_served)}
              label={t("landing.stats.countriesLabel")}
              meta={t("landing.stats.countriesMeta")}
            />
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="lp-how" id="how" aria-labelledby="lp-how-title">
        <div className="lp-container">
          <div className="lp-section-head-center">
            <span className="lp-eyebrow">
              <ActivityIcon className="lp-icon lp-icon-sm" />
              {t("landing.howItWorks.eyebrow")}
            </span>
            <h2 className="lp-section-title" id="lp-how-title">
              {t("landing.howItWorks.title")}{" "}
              <span className="soft">{t("landing.howItWorks.titleAccent")}</span>
            </h2>
            <p className="lp-section-lede">{t("landing.howItWorks.lede")}</p>
          </div>

          <div className="lp-how-grid">
            <HowCard num={1} icon={<SearchIcon className="lp-icon lp-icon-xl" />} step="step1" />
            <HowCard num={2} icon={<HeartIcon className="lp-icon lp-icon-xl" />} step="step2" />
            <HowCard num={3} icon={<ActivityIcon className="lp-icon lp-icon-xl" />} step="step3" />
          </div>
        </div>
      </section>

      {/* ═══ PARTNERS ═══ */}
      <section className="lp-partners" id="partners" aria-labelledby="lp-partners-title">
        <div className="lp-container">
          <div className="lp-section-head-center">
            <span className="lp-eyebrow">
              <BankIcon className="lp-icon lp-icon-sm" />
              {t("landing.partners.eyebrow")}
            </span>
            <h2 className="lp-section-title" id="lp-partners-title">
              {t("landing.partners.title")}{" "}
              <span className="soft">{t("landing.partners.titleAccent")}</span>
            </h2>
            <p className="lp-section-lede">{t("landing.partners.lede")}</p>
          </div>

          {/* Sample partner organizations — illustrative placeholders, not
              real org names (initials only). TODO(backend): no per-partner
              orphan counts exposed publicly; counts shown as placeholders. */}
          <div className="lp-partner-grid">
            {(["p1", "p2", "p3", "p4"] as const).map((p, i) => (
              <div key={p} className={`lp-partner-card lp-partner-card--${i + 1}`}>
                <div className="lp-partner-logo">
                  <span aria-hidden="true">{t(`landing.partners.${p}.mark`)}</span>
                </div>
                <div className="lp-partner-name">{t(`landing.partners.${p}.name`)}</div>
                <div className="lp-partner-meta">
                  <span>{t(`landing.partners.${p}.country`)}</span>
                  <span className="dot" aria-hidden="true" />
                  <span>{t("landing.partners.orphanCount", { count: PLACEHOLDER })}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="lp-partners-footer">
            {/* TODO(backend): no public count of total partner organizations
                or partner countries — both rendered as placeholders. */}
            <span>{t("landing.partners.footerCount", { orgs: PLACEHOLDER, countries: PLACEHOLDER })} </span>
            <Link to="/partners">
              {t("landing.partners.footerLink")}
              <ArrowEndIcon className="lp-icon lp-icon-sm lp-arrow-end" />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ TESTIMONIALS ═══ */}
      <section className="lp-testimonials" aria-labelledby="lp-testimonials-title">
        <div className="lp-container">
          <div className="lp-section-head-center">
            <span className="lp-sample-badge">
              <InfoIcon className="lp-icon lp-icon-sm" />
              {t("landing.testimonials.sampleBadge")}
            </span>
            <h2 className="lp-section-title" id="lp-testimonials-title">
              {t("landing.testimonials.title")}{" "}
              <span className="soft">{t("landing.testimonials.titleAccent")}</span>
            </h2>
          </div>

          <div className="lp-testimonials-grid">
            {(["t1", "t2", "t3"] as const).map((k) => (
              <article key={k} className="lp-testimonial">
                <span className="lp-testimonial-quote-mark" aria-hidden="true">
                  {"”"}
                </span>
                <p className="lp-testimonial-text">{t(`landing.testimonials.${k}.text`)}</p>
                <div className="lp-testimonial-attr">
                  <div className="lp-testimonial-avatar" aria-hidden="true">
                    {t(`landing.testimonials.${k}.initials`)}
                  </div>
                  <div className="lp-testimonial-attr-info">
                    <span className="lp-testimonial-attr-name">
                      {t(`landing.testimonials.${k}.name`)}
                    </span>
                    <span className="lp-testimonial-attr-meta">
                      {t(`landing.testimonials.${k}.meta`)}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TRANSPARENCY ═══ */}
      <section className="lp-transparency" id="transparency" aria-labelledby="lp-transparency-title">
        <div className="lp-container">
          <div className="lp-transparency-grid">
            <div className="lp-transparency-copy">
              <span className="lp-eyebrow">
                <LockIcon className="lp-icon lp-icon-sm" />
                {t("landing.transparency.eyebrow")}
              </span>
              <h2 className="lp-section-title" id="lp-transparency-title">
                {t("landing.transparency.title")}{" "}
                <span className="soft">{t("landing.transparency.titleAccent")}</span>
              </h2>
              <p className="lp-section-lede">{t("landing.transparency.lede")}</p>

              <div className="lp-transparency-list">
                <TransparencyItem icon={<CheckCircleIcon className="lp-icon" />} k="t1" />
                <TransparencyItem icon={<CodeIcon className="lp-icon" />} k="t2" />
                <TransparencyItem icon={<CheckCircleIcon className="lp-icon" />} k="t3" />
              </div>
            </div>

            <AllocationCard />
          </div>
        </div>
      </section>

      {/* ═══ HADITH STRIP ═══ */}
      <section className="lp-hadith" aria-labelledby="lp-hadith-title">
        <div className="lp-hadith-inner">
          <h2 id="lp-hadith-title" className="sr-only">
            {t("landing.hadith.srTitle")}
          </h2>
          <span className="lp-hadith-quote-mark" aria-hidden="true">
            {"”"}
          </span>
          <p className="lp-hadith-text">{t("landing.hadith.text")}</p>
          <div className="lp-hadith-attr">
            <span>{t("landing.hadith.source")}</span>
            <span className="dot" aria-hidden="true" />
            <span>{t("landing.hadith.narrator")}</span>
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="lp-final-cta" aria-labelledby="lp-final-cta-title">
        <div className="lp-container">
          <div className="lp-final-cta-inner">
            <span className="lp-final-cta-eyebrow">
              <HeartIcon className="lp-icon lp-icon-sm" />
              {t("landing.finalCta.eyebrow")}
            </span>

            <h2 className="lp-final-cta-title" id="lp-final-cta-title">
              {t("landing.finalCta.title")} <span className="soft">{t("landing.finalCta.titleSoft")}</span>
            </h2>

            <p className="lp-final-cta-lede">
              {/* Available-orphans count sourced from /public/stats. */}
              {t("landing.finalCta.lede", { count: numOrNa(stats?.orphans_available) })}
            </p>

            <div className="lp-final-cta-actions">
              <Link className="lp-btn lp-btn-light lp-btn-xl" to="/orphans">
                <SearchIcon className="lp-icon" />
                {t("landing.finalCta.browse")}
              </Link>
              <Link className="lp-btn lp-btn-outline-light lp-btn-xl" to="/partners">
                {t("landing.finalCta.partner")}
              </Link>
            </div>

            <div className="lp-final-cta-meta">
              <span className="item">
                <CheckIcon className="lp-icon lp-icon-sm" />
                {t("landing.finalCta.meta1")}
              </span>
              <span className="sep" aria-hidden="true" />
              <span className="item">
                <CheckIcon className="lp-icon lp-icon-sm" />
                {t("landing.finalCta.meta2")}
              </span>
              <span className="sep" aria-hidden="true" />
              <span className="item">
                <CheckIcon className="lp-icon lp-icon-sm" />
                {t("landing.finalCta.meta3")}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════════════
function ShieldSmall() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="lp-icon lp-icon-sm">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function Stat({ value, label, meta }: { value: string; label: string; meta: string }) {
  return (
    <div className="lp-stat">
      <div className="lp-stat-value">
        <span className="latin">{value}</span>
      </div>
      <div className="lp-stat-label">{label}</div>
      <div className="lp-stat-meta">{meta}</div>
    </div>
  );
}

function HowCard({ num, icon, step }: { num: number; icon: ReactNode; step: string }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="lp-how-card">
      <div className="lp-how-step-mark">
        <span className="lp-how-step-num latin">{num.toLocaleString(i18n.language)}</span>
        {icon}
      </div>
      <h3 className="lp-how-card-title">{t(`landing.howItWorks.${step}.title`)}</h3>
      <p className="lp-how-card-desc">{t(`landing.howItWorks.${step}.desc`)}</p>
    </div>
  );
}

function TransparencyItem({ icon, k }: { icon: ReactNode; k: string }) {
  const { t } = useTranslation();
  return (
    <div className="lp-transparency-item">
      <div className="lp-transparency-item-icon">{icon}</div>
      <div>
        <div className="lp-transparency-item-title">{t(`landing.transparency.${k}.title`)}</div>
        <div className="lp-transparency-item-desc">{t(`landing.transparency.${k}.desc`)}</div>
      </div>
    </div>
  );
}

// Illustrative funds-allocation breakdown (95/3/2). These are sample
// figures from the design mockup, not live data — kept as keyed content.
function AllocationCard() {
  const { t } = useTranslation();
  return (
    <div className="lp-allocation-card">
      <div className="lp-allocation-head">
        <div className="lp-allocation-title">
          <BarChartIcon className="lp-icon lp-icon-sm" />
          {t("landing.allocation.title")}
        </div>
        <span className="lp-allocation-period">{t("landing.allocation.period")}</span>
      </div>

      <div className="lp-allocation-body">
        <div className="lp-donut" role="img" aria-label={t("landing.allocation.ariaLabel")}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="#EAF1F7" strokeWidth="3.6" />
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              stroke="#769FCD"
              strokeWidth="3.6"
              strokeDasharray="95 100"
              strokeDashoffset="0"
              strokeLinecap="round"
            />
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              stroke="#9CC3DE"
              strokeWidth="3.6"
              strokeDasharray="3 100"
              strokeDashoffset="-95"
            />
            <circle
              cx="18"
              cy="18"
              r="15.915"
              fill="none"
              stroke="#C2D8EC"
              strokeWidth="3.6"
              strokeDasharray="2 100"
              strokeDashoffset="-98"
            />
          </svg>
          <div className="lp-donut-center" aria-hidden="true">
            <div className="lp-donut-center-num latin">95%</div>
            <div className="lp-donut-center-label">{t("landing.allocation.toOrphans")}</div>
          </div>
        </div>

        <div className="lp-allocation-legend">
          <div className="lp-legend-row">
            <span className="lp-legend-swatch s1" aria-hidden="true" />
            <span className="lp-legend-label">{t("landing.allocation.toOrphans")}</span>
            <span className="lp-legend-value latin">95%</span>
          </div>
          <div className="lp-legend-row">
            <span className="lp-legend-swatch s2" aria-hidden="true" />
            <span className="lp-legend-label">{t("landing.allocation.operations")}</span>
            <span className="lp-legend-value latin">3%</span>
          </div>
          <div className="lp-legend-row">
            <span className="lp-legend-swatch s3" aria-hidden="true" />
            <span className="lp-legend-label">{t("landing.allocation.reserve")}</span>
            <span className="lp-legend-value latin">2%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Abstract geometric Islamic-inspired hero motif + floating chips.
// Decorative only — no real imagery, fully aria-hidden.
function HeroArt() {
  const { t } = useTranslation();
  return (
    <div className="lp-hero-art" aria-hidden="true">
      <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lp-g1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#769FCD" stopOpacity=".25" />
            <stop offset="100%" stopColor="#769FCD" stopOpacity=".05" />
          </linearGradient>
          <linearGradient id="lp-g2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D6E6F2" />
            <stop offset="100%" stopColor="#B9D7EA" />
          </linearGradient>
          <linearGradient id="lp-g3" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#EAF1F7" />
          </linearGradient>
        </defs>

        <circle cx="200" cy="200" r="190" fill="url(#lp-g1)" />
        <circle cx="200" cy="200" r="160" fill="none" stroke="#B9D7EA" strokeWidth="1" strokeDasharray="3 6" opacity=".7" />

        <g transform="translate(200 200)">
          <g fill="url(#lp-g2)" stroke="#769FCD" strokeWidth="1.5" strokeLinejoin="round">
            <polygon points="0,-90 22,-22 90,0 22,22 0,90 -22,22 -90,0 -22,-22" />
            <polygon points="0,-90 22,-22 90,0 22,22 0,90 -22,22 -90,0 -22,-22" transform="rotate(45)" />
          </g>
          <circle r="34" fill="url(#lp-g3)" stroke="#769FCD" strokeWidth="1.5" />
          <text
            x="0"
            y="14"
            textAnchor="middle"
            fontFamily="IBM Plex Sans Arabic, sans-serif"
            fontSize="42"
            fontWeight="600"
            fill="#2D5683"
          >
            {"ر"}
          </text>
        </g>

        <g fill="white" stroke="#9CC3DE" strokeWidth="1.5">
          <circle cx="200" cy="40" r="14" />
          <circle cx="333" cy="113" r="14" />
          <circle cx="333" cy="287" r="14" />
          <circle cx="200" cy="360" r="14" />
          <circle cx="67" cy="287" r="14" />
          <circle cx="67" cy="113" r="14" />
        </g>
        <g fill="#769FCD">
          <circle cx="200" cy="40" r="6" />
          <circle cx="333" cy="113" r="6" />
          <circle cx="333" cy="287" r="6" />
          <circle cx="200" cy="360" r="6" />
          <circle cx="67" cy="287" r="6" />
          <circle cx="67" cy="113" r="6" />
        </g>

        <g stroke="#B9D7EA" strokeWidth="1" strokeDasharray="2 4" fill="none" opacity=".6">
          <line x1="200" y1="40" x2="200" y2="200" />
          <line x1="333" y1="113" x2="200" y2="200" />
          <line x1="333" y1="287" x2="200" y2="200" />
          <line x1="200" y1="360" x2="200" y2="200" />
          <line x1="67" y1="287" x2="200" y2="200" />
          <line x1="67" y1="113" x2="200" y2="200" />
        </g>
      </svg>

      <div className="lp-hero-art-card lp-hero-art-card-1">
        <div className="lp-hero-art-card-icon">
          <CheckIcon className="lp-icon lp-icon-sm" />
        </div>
        <div className="lp-hero-art-card-text">
          <strong>{t("landing.hero.chip1Title")}</strong>
          <span>{t("landing.hero.chip1Sub")}</span>
        </div>
      </div>

      <div className="lp-hero-art-card lp-hero-art-card-2">
        <div className="lp-hero-art-card-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="lp-icon lp-icon-sm">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="lp-hero-art-card-text">
          <strong>{t("landing.hero.chip2Title")}</strong>
          <span>{t("landing.hero.chip2Sub")}</span>
        </div>
      </div>
    </div>
  );
}
