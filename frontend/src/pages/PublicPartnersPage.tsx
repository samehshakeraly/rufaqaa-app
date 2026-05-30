import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  ArrowEndIcon,
  BarChartIcon,
  BuildingIcon,
  CheckIcon,
  GlobeIcon,
  InfoIcon,
  MessageIcon,
  PlusIcon,
  StarIcon,
} from "@/components/public/icons";

import "./PublicPartnersPage.css";

/**
 * W-05 — Partners (/partners). Ported pixel-for-pixel from
 * docs/design/screens/public/W-05-Partners.html. Body sections only
 * (hero, geographic schematic, verified-partner grid, how-to-join
 * steps + benefits, closing CTA); the shared nav + footer come from
 * PublicSiteLayout. Styles live in PublicPartnersPage.css, scoped
 * under `.pt-root` and prefixed `pt-`, mirroring the OA-01 pattern.
 *
 * IMPORTANT — no real organizations are named. Sameh hasn't confirmed
 * consent from the real partner charities, so every card uses the
 * `public.partners.list.placeholderName` i18n key ("شريك ١" / "Partner 1")
 * and every figure renders as the "—" placeholder. The geographic map
 * is a decorative schematic (aria-hidden) with generic country labels
 * and "—" counts — it asserts no concrete partner distribution. Swap in
 * real names/figures only after each organization confirms consent and a
 * backend stats source exists. // TODO(backend): partner roster + figures.
 */

const PLACEHOLDER = "—";

// Decorative schematic pins. Position classes only; counts shown as "—"
// since no partner-distribution endpoint exists yet. Labels are generic
// country names (geographic, not partner identities).
const MAP_PINS = [
  { key: "c1", pos: "pt-pin-1", size: "" },
  { key: "c2", pos: "pt-pin-2", size: "md" },
  { key: "c3", pos: "pt-pin-3", size: "md" },
  { key: "c4", pos: "pt-pin-4", size: "md" },
  { key: "c5", pos: "pt-pin-5", size: "sm" },
  { key: "c6", pos: "pt-pin-6", size: "sm" },
  { key: "c7", pos: "pt-pin-7", size: "sm" },
  { key: "c8", pos: "pt-pin-8", size: "sm" },
] as const;

// Six placeholder partner cards. `tone` only drives the monogram tint
// (cool/green/warm/deep) from the mockup; it carries no real meaning.
const PARTNER_TONES = ["cool", "green", "warm", "deep", "cool", "green"] as const;

const JOIN_STEPS = [1, 2, 3, 4, 5] as const;

const BENEFITS: { key: "b1" | "b2" | "b3" | "b4"; icon: ReactNode }[] = [
  { key: "b1", icon: <CheckIcon className="pt-icon" /> },
  { key: "b2", icon: <MessageIcon className="pt-icon" /> },
  { key: "b3", icon: <GlobeIcon className="pt-icon" /> },
  { key: "b4", icon: <BarChartIcon className="pt-icon" /> },
];

export function PublicPartnersPage() {
  const { t } = useTranslation();

  return (
    <div className="pt-root">
      <SeoHead
        titleKey="public.partners.meta.title"
        descriptionKey="public.partners.meta.description"
      />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="pt-hero" aria-labelledby="pt-hero-title">
        <div className="pt-container pt-hero-inner">
          <span className="pt-eyebrow">
            <span className="pt-dot" aria-hidden="true" />
            {t("public.partners.hero.eyebrow")}
          </span>
          <h1 className="pt-hero-title" id="pt-hero-title">
            {t("public.partners.hero.title")}{" "}
            <span className="pt-accent">{t("public.partners.hero.titleAccent")}</span>
          </h1>
          <p className="pt-hero-sub">{t("public.partners.hero.subtitle")}</p>

          {/* Hero figures — no backed stats source yet. // TODO(backend) */}
          <dl className="pt-hero-stats-row">
            <div className="pt-hero-stat">
              <dd className="pt-hero-stat-value latin">{PLACEHOLDER}</dd>
              <dt className="pt-hero-stat-label">{t("public.partners.hero.statPartners")}</dt>
            </div>
            <div className="pt-hero-stat">
              <dd className="pt-hero-stat-value latin">{PLACEHOLDER}</dd>
              <dt className="pt-hero-stat-label">{t("public.partners.hero.statCountries")}</dt>
            </div>
            <div className="pt-hero-stat">
              <dd className="pt-hero-stat-value latin">{PLACEHOLDER}</dd>
              <dt className="pt-hero-stat-label">{t("public.partners.hero.statOrphans")}</dt>
            </div>
            <div className="pt-hero-stat">
              <dd className="pt-hero-stat-value latin">{PLACEHOLDER}</dd>
              <dt className="pt-hero-stat-label">{t("public.partners.hero.statVerified")}</dt>
            </div>
          </dl>
        </div>
      </section>

      {/* ── MAP — geographic schematic (decorative) ──────────────── */}
      <section className="pt-map-section" aria-labelledby="pt-map-title">
        <div className="pt-container">
          <div className="pt-map-card">
            <div className="pt-map-head">
              <div className="pt-map-title">
                <GlobeIcon className="pt-icon" />
                <h2 id="pt-map-title">{t("public.partners.map.title")}</h2>
              </div>
              <div className="pt-map-legend">
                <span className="pt-map-legend-item">
                  <span className="pt-map-legend-dot lg" aria-hidden="true" />
                  {t("public.partners.map.legendHigh")}
                </span>
                <span className="pt-map-legend-item">
                  <span className="pt-map-legend-dot md" aria-hidden="true" />
                  {t("public.partners.map.legendMid")}
                </span>
                <span className="pt-map-legend-item">
                  <span className="pt-map-legend-dot sm" aria-hidden="true" />
                  {t("public.partners.map.legendLow")}
                </span>
              </div>
            </div>

            {/* Decorative schematic — counts unbacked, shown as "—". */}
            <div className="pt-map-canvas" aria-hidden="true">
              {MAP_PINS.map((pin) => (
                <div key={pin.key} className={`pt-map-pin ${pin.size} ${pin.pos}`.trim()}>
                  <div className="pt-map-pin-dot" />
                  <span className="pt-map-pin-label">
                    {t(`public.partners.map.${pin.key}`)}
                    <span className="count latin">{PLACEHOLDER}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── PARTNERS LIST (placeholder names — pending consent) ──── */}
      <section className="pt-partners-list" aria-labelledby="pt-list-title">
        <div className="pt-container">
          <div className="pt-section-head-center">
            <span className="pt-eyebrow">{t("public.partners.list.eyebrow")}</span>
            <h2 className="pt-section-title" id="pt-list-title">
              {t("public.partners.list.title")}{" "}
              <span className="pt-accent-soft">{t("public.partners.list.titleAccent")}</span>
            </h2>
            <p className="pt-section-lede">{t("public.partners.list.lede")}</p>
          </div>

          <div className="pt-placeholder-note">
            <InfoIcon className="pt-icon pt-icon-sm" />
            <span>{t("public.partners.list.placeholderNote")}</span>
          </div>

          <div className="pt-partner-grid">
            {PARTNER_TONES.map((tone, i) => {
              const n = i + 1;
              return (
                <article key={n} className={`pt-partner-card ${tone}`}>
                  <div className="pt-partner-card-head">
                    {/* Placeholder monogram — never a real logo. */}
                    <div className="pt-partner-logo" aria-hidden="true">
                      <BuildingIcon className="pt-icon pt-icon-lg" />
                    </div>
                    <div className="pt-partner-card-id">
                      <div className="pt-partner-name">
                        {t("public.partners.list.placeholderName")}{" "}
                        <span className="latin">{n}</span>
                      </div>
                      <div className="pt-partner-country">{t("public.partners.list.country")}</div>
                    </div>
                    <span className="pt-partner-status verified">
                      <CheckIcon className="pt-icon pt-icon-sm" />
                      {t("public.partners.list.verified")}
                    </span>
                  </div>

                  <div className="pt-partner-figures">
                    <div>
                      <div className="pt-partner-figure-label">
                        {t("public.partners.list.orphansLabel")}
                      </div>
                      {/* No backed figure yet. // TODO(backend) */}
                      <div className="pt-partner-figure-value latin">{PLACEHOLDER}</div>
                    </div>
                    <div>
                      <div className="pt-partner-figure-label">
                        {t("public.partners.list.sinceLabel")}
                      </div>
                      <div className="pt-partner-figure-value latin">{PLACEHOLDER}</div>
                    </div>
                  </div>

                  <div className="pt-partner-meta">
                    <span className="pt-partner-meta-item">
                      <CheckIcon className="pt-icon pt-icon-sm" />
                      {t("public.partners.list.licensed")}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="pt-view-all">
            <Link to="/contact" className="pt-btn pt-btn-secondary pt-btn-lg">
              {t("public.partners.list.viewAll")}
              <ArrowEndIcon className="pt-icon pt-icon-sm" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── JOIN AS PARTNER ──────────────────────────────────────── */}
      <section className="pt-join" id="join" aria-labelledby="pt-join-title">
        <div className="pt-container">
          <div className="pt-section-head-center">
            <span className="pt-eyebrow">{t("public.partners.join.eyebrow")}</span>
            <h2 className="pt-section-title" id="pt-join-title">
              {t("public.partners.join.title")}{" "}
              <span className="pt-accent-soft">{t("public.partners.join.titleAccent")}</span>
            </h2>
            <p className="pt-section-lede">{t("public.partners.join.lede")}</p>
          </div>

          <div className="pt-join-grid">
            <div className="pt-join-copy">
              <h3 className="pt-join-copy-title">{t("public.partners.join.stepsTitle")}</h3>

              <ol className="pt-join-steps">
                {JOIN_STEPS.map((n) => (
                  <li key={n} className="pt-join-step">
                    <span className="pt-join-step-num latin" aria-hidden="true">
                      {n}
                    </span>
                    <div className="pt-join-step-body">
                      <div className="pt-join-step-title">
                        {t(`public.partners.join.s${n}Title`)}
                      </div>
                      <div className="pt-join-step-desc">
                        {t(`public.partners.join.s${n}Desc`)}
                      </div>
                    </div>
                    <span className="pt-join-step-dur">{t(`public.partners.join.s${n}Dur`)}</span>
                  </li>
                ))}
              </ol>

              <div className="pt-join-cta">
                <Link to="/contact" className="pt-btn pt-btn-primary pt-btn-lg">
                  {t("public.partners.join.startButton")}
                  <ArrowEndIcon className="pt-icon pt-icon-sm" />
                </Link>
              </div>
            </div>

            <div className="pt-benefits">
              <div className="pt-benefits-title">
                <StarIcon className="pt-icon pt-icon-lg" />
                {t("public.partners.join.benefitsTitle")}
              </div>
              <div className="pt-benefits-list">
                {BENEFITS.map(({ key, icon }) => (
                  <div key={key} className="pt-benefit">
                    <div className="pt-benefit-icon">{icon}</div>
                    <div>
                      <div className="pt-benefit-title">
                        {t(`public.partners.join.${key}Title`)}
                      </div>
                      <div className="pt-benefit-desc">{t(`public.partners.join.${key}Desc`)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="pt-cta" aria-labelledby="pt-cta-title">
        <div className="pt-container">
          <div className="pt-cta-inner">
            <span className="pt-cta-eyebrow">
              <BuildingIcon className="pt-icon pt-icon-sm" />
              {t("public.partners.cta.eyebrow")}
            </span>
            <h2 className="pt-cta-title" id="pt-cta-title">
              {t("public.partners.cta.title")}{" "}
              <span className="soft">{t("public.partners.cta.titleSoft")}</span>
            </h2>
            <p className="pt-cta-lede">{t("public.partners.cta.lede")}</p>
            <div className="pt-cta-actions">
              <a href="#join" className="pt-btn pt-btn-light pt-btn-xl">
                <PlusIcon className="pt-icon" />
                {t("public.partners.cta.join")}
              </a>
              <Link to="/contact" className="pt-btn pt-btn-outline-light pt-btn-xl">
                {t("public.partners.cta.question")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
