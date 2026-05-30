import type { ReactNode, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  EyeIcon,
  FileTextIcon,
  GithubIcon,
  GlobeIcon,
  HeartIcon,
  LockIcon,
  MailIcon,
  NetworkIcon,
  PlusIcon,
  ShieldIcon,
  StarIcon,
  UsersIcon,
} from "@/components/public/icons";

import "./AboutPage.css";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";
const PROFILE_URL = "https://github.com/samehshakeraly";
const FOUNDER_EMAIL = "hello@rufaqaa.app";

// Per the rufaqaa v0.1 icon language: scoped, decorative, sized via the
// .ab-icon utilities defined in AboutPage.css.
type IconCmp = (props: SVGProps<SVGSVGElement>) => ReactNode;

const PLACEHOLDER = "—";

/**
 * W-02 — About (/about). Pixel-matched to docs/design/screens/public/
 * W-02-About.html, mirroring the OA-01 scoped-CSS pattern: a `.ab-root`
 * wrapper carrying the design-system token block, child classes prefixed
 * `ab-`, all physical left/right rewritten as logical for RTL-first.
 *
 * Rendered inside PublicSiteLayout (shared PublicNav + PublicFooter
 * shell), so this returns the page body only — no nav/footer/head ports.
 *
 * No real imagery: founder/team avatars are typographic placeholders.
 * No fabricated figures: the open-source repo "stats" are static-page
 * content with no backend source, so they render the `—` placeholder.
 */
export function AboutPage() {
  const { t } = useTranslation();

  const phases = [1, 2, 3] as const;

  const values: { name: string; desc: string; Icon: IconCmp }[] = [
    { name: "public.about.values.v1Name", desc: "public.about.values.v1Desc", Icon: StarIcon },
    { name: "public.about.values.v2Name", desc: "public.about.values.v2Desc", Icon: LockIcon },
    { name: "public.about.values.v3Name", desc: "public.about.values.v3Desc", Icon: HeartIcon },
    { name: "public.about.values.v4Name", desc: "public.about.values.v4Desc", Icon: CheckIcon },
  ];

  const osPoints = [
    "public.about.os.point1",
    "public.about.os.point2",
    "public.about.os.point3",
    "public.about.os.point4",
  ];

  // TODO(backend): the open-source repo figures (stars/forks/contributors)
  // have no data source on this static marketing page — show `—` rather
  // than fabricating counts.
  const osStats: { key: string; Icon: IconCmp }[] = [
    { key: "public.about.os.stars", Icon: StarIcon },
    { key: "public.about.os.forks", Icon: NetworkIcon },
    { key: "public.about.os.contributors", Icon: UsersIcon },
  ];

  const teamRoles = [
    "public.about.team.role1",
    "public.about.team.role2",
    "public.about.team.role3",
    "public.about.team.role4",
    "public.about.team.role5",
  ];

  return (
    <div className="ab-root">
      <SeoHead titleKey="public.about.meta.title" descriptionKey="public.about.meta.description" />

      {/* ── HERO ───────────────────────────────────────────────────── */}
      <section className="ab-hero" aria-labelledby="ab-hero-title">
        <div className="ab-container ab-hero-inner">
          <span className="ab-eyebrow">
            <span className="ab-dot" aria-hidden="true" />
            {t("public.about.hero.eyebrow")}
          </span>

          <h1 className="ab-hero-title" id="ab-hero-title">
            {t("public.about.hero.title")}{" "}
            <span className="ab-accent">{t("public.about.hero.titleAccent")}</span>
          </h1>

          <p className="ab-hero-sub">{t("public.about.hero.subtitle")}</p>

          <div className="ab-hero-meta">
            <span className="ab-item">
              <CalendarIcon className="ab-icon ab-icon-sm" />
              {t("public.about.hero.metaFounded")}
            </span>
            <span className="ab-sep" aria-hidden="true" />
            <span className="ab-item">
              <CodeIcon className="ab-icon ab-icon-sm" />
              {t("public.about.hero.metaOpenSource")}
            </span>
            <span className="ab-sep" aria-hidden="true" />
            <span className="ab-item">
              <StarIcon className="ab-icon ab-icon-sm" />
              {t("public.about.hero.metaWaqf")}
            </span>
          </div>
        </div>
      </section>

      {/* ── STORY ──────────────────────────────────────────────────── */}
      <section className="ab-story" aria-labelledby="ab-story-title">
        <div className="ab-container">
          <div className="ab-story-head">
            <span className="ab-eyebrow">{t("public.about.story.eyebrow")}</span>
            <h2 className="ab-section-title" id="ab-story-title">
              {t("public.about.story.title")}{" "}
              <span className="ab-accent">{t("public.about.story.titleAccent")}</span>
            </h2>
            <p className="ab-section-lede">{t("public.about.story.lede")}</p>
          </div>

          <div className="ab-story-phases">
            {phases.map((n) => (
              <article key={n} className="ab-phase-card">
                <div className="ab-phase-mark">
                  <ShieldIcon className="ab-icon ab-icon-xl" />
                  <span className="ab-phase-year">{t(`public.about.story.phase${n}Year`)}</span>
                </div>
                <h3 className="ab-phase-card-title">{t(`public.about.story.phase${n}Title`)}</h3>
                <p className="ab-phase-card-desc">{t(`public.about.story.phase${n}Desc`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── VISION + MISSION ───────────────────────────────────────── */}
      <section className="ab-vm" aria-labelledby="ab-vm-title">
        <div className="ab-container">
          <div className="ab-section-head-center">
            <span className="ab-eyebrow">{t("public.about.vm.eyebrow")}</span>
            <h2 className="ab-section-title" id="ab-vm-title">
              {t("public.about.vm.title")}{" "}
              <span className="ab-accent">{t("public.about.vm.titleAccent")}</span>
            </h2>
          </div>

          <div className="ab-vm-grid">
            {(["vision", "mission"] as const).map((k) => (
              <article key={k} className="ab-vm-card">
                <div className="ab-vm-icon" aria-hidden="true">
                  {k === "vision" ? (
                    <EyeIcon className="ab-icon ab-icon-lg" />
                  ) : (
                    <ClockIcon className="ab-icon ab-icon-lg" />
                  )}
                </div>
                <div className="ab-vm-label">{t(`public.about.vm.${k}Label`)}</div>
                <h3 className="ab-vm-title">{t(`public.about.vm.${k}Title`)}</h3>
                <p className="ab-vm-body">{t(`public.about.vm.${k}Body`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── VALUES ─────────────────────────────────────────────────── */}
      <section className="ab-values" aria-labelledby="ab-values-title">
        <div className="ab-container">
          <div className="ab-section-head-center">
            <span className="ab-eyebrow">{t("public.about.values.eyebrow")}</span>
            <h2 className="ab-section-title" id="ab-values-title">
              {t("public.about.values.title")}{" "}
              <span className="ab-accent">{t("public.about.values.titleAccent")}</span>
            </h2>
            <p className="ab-section-lede">{t("public.about.values.lede")}</p>
          </div>

          <div className="ab-values-grid">
            {values.map(({ name, desc, Icon }) => (
              <article key={name} className="ab-value-card">
                <div className="ab-value-icon" aria-hidden="true">
                  <Icon className="ab-icon ab-icon-lg" />
                </div>
                <h3 className="ab-value-name">{t(name)}</h3>
                <p className="ab-value-desc">{t(desc)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── HADITH + TAFSIR ────────────────────────────────────────── */}
      <section className="ab-hadith" aria-labelledby="ab-hadith-title">
        <div className="ab-container">
          <div className="ab-section-head-center">
            <span className="ab-eyebrow">{t("public.about.hadith.eyebrow")}</span>
            <h2 className="ab-section-title" id="ab-hadith-title">
              {t("public.about.hadith.title")}{" "}
              <span className="ab-accent">{t("public.about.hadith.titleAccent")}</span>
            </h2>
          </div>

          <div className="ab-hadith-card">
            <p className="ab-hadith-text">{t("public.about.hadith.text")}</p>
            <div className="ab-hadith-attr">
              <span>{t("public.about.hadith.source")}</span>
              <span className="ab-dot" aria-hidden="true" />
              <span>{t("public.about.hadith.narrator")}</span>
            </div>

            <div className="ab-tafsir">
              <div className="ab-tafsir-label">
                <FileTextIcon className="ab-icon ab-icon-sm" />
                {t("public.about.hadith.tafsirLabel")}
              </div>
              <p className="ab-tafsir-text">{t("public.about.hadith.tafsir")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── OPEN SOURCE ────────────────────────────────────────────── */}
      <section className="ab-os" aria-labelledby="ab-os-title">
        <div className="ab-container">
          <div className="ab-os-grid">
            <div className="ab-os-copy">
              <span className="ab-eyebrow">{t("public.about.os.eyebrow")}</span>
              <h2 className="ab-section-title" id="ab-os-title">
                {t("public.about.os.title")}{" "}
                <span className="ab-accent">{t("public.about.os.titleAccent")}</span>
              </h2>
              <p className="ab-section-lede">{t("public.about.os.lede")}</p>

              <ul className="ab-os-points">
                {osPoints.map((p) => (
                  <li key={p} className="ab-os-point">
                    <span className="ab-os-point-tick" aria-hidden="true">
                      <CheckIcon className="ab-icon ab-icon-sm" />
                    </span>
                    <span>{t(p)}</span>
                  </li>
                ))}
              </ul>

              <div className="ab-os-cta">
                <a className="ab-btn ab-btn-dark ab-btn-lg" href={REPO_URL} rel="noopener" target="_blank">
                  <GithubIcon className="ab-icon ab-icon-sm" />
                  {t("public.about.os.repoButton")}
                </a>
              </div>
            </div>

            {/* Decorative code-window. The repo figures have no backend
                source on this static page → `—` placeholders, no fabricated
                counts; commit feed omitted for the same reason. */}
            <div className="ab-os-visual" aria-hidden="true">
              <div className="ab-os-window-bar">
                <div className="ab-os-window-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="ab-os-window-title">{t("public.about.os.windowTitle")}</div>
              </div>

              <div className="ab-os-repo-name">
                <GithubIcon className="ab-icon ab-icon-sm" />
                samehshakeraly / rufaqaa-app
              </div>

              <div className="ab-os-repo-stats">
                {osStats.map(({ key, Icon }) => (
                  <div key={key} className="ab-os-stat">
                    <div className="ab-os-stat-label">
                      <Icon className="ab-icon ab-icon-sm" />
                      {t(key)}
                    </div>
                    <div className="ab-os-stat-value">{PLACEHOLDER}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOUNDER ────────────────────────────────────────────────── */}
      <section className="ab-founder" aria-labelledby="ab-founder-title">
        <div className="ab-container">
          <div className="ab-section-head-center">
            <span className="ab-eyebrow">{t("public.about.founder.eyebrow")}</span>
            <h2 className="ab-section-title" id="ab-founder-title">
              {t("public.about.founder.title")}{" "}
              <span className="ab-accent">{t("public.about.founder.titleAccent")}</span>
            </h2>
          </div>

          <article className="ab-founder-card">
            <div className="ab-founder-avatar" aria-hidden="true">
              {t("public.about.founder.initials")}
            </div>

            <div className="ab-founder-info">
              <div className="ab-founder-label">{t("public.about.founder.label")}</div>
              <h3 className="ab-founder-name">{t("public.about.founder.name")}</h3>
              <div className="ab-founder-title-line">{t("public.about.founder.titleLine")}</div>

              <p className="ab-founder-bio">{t("public.about.founder.bio1")}</p>
              <p className="ab-founder-bio">{t("public.about.founder.bio2")}</p>

              <div className="ab-founder-links">
                <a className="ab-founder-link" href={PROFILE_URL} rel="noopener" target="_blank">
                  <GithubIcon className="ab-icon ab-icon-sm" />
                  <span className="latin">@samehshakeraly</span>
                </a>
                <a className="ab-founder-link" href={REPO_URL} rel="noopener" target="_blank">
                  <GlobeIcon className="ab-icon ab-icon-sm" />
                  <span>{t("public.about.founder.linkSeries")}</span>
                </a>
                <a className="ab-founder-link" href={`mailto:${FOUNDER_EMAIL}`}>
                  <MailIcon className="ab-icon ab-icon-sm" />
                  <span className="latin">{FOUNDER_EMAIL}</span>
                </a>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* ── TEAM ───────────────────────────────────────────────────── */}
      <section className="ab-team" aria-labelledby="ab-team-title">
        <div className="ab-container">
          <div className="ab-team-head">
            <span className="ab-sample-badge">
              <PlusIcon className="ab-icon ab-icon-sm" />
              {t("public.about.team.badge")}
            </span>
            <h2 className="ab-section-title" id="ab-team-title">
              {t("public.about.team.title")}{" "}
              <span className="ab-accent">{t("public.about.team.titleAccent")}</span>
            </h2>
            <p className="ab-section-lede">{t("public.about.team.lede")}</p>
          </div>

          <div className="ab-team-grid">
            <article className="ab-team-card filled">
              <div className="ab-team-avatar" aria-hidden="true">
                {t("public.about.team.leadInitials")}
              </div>
              <div className="ab-team-name">{t("public.about.team.leadName")}</div>
              <div className="ab-team-role">{t("public.about.team.leadRole")}</div>
            </article>

            {teamRoles.map((role) => (
              <article key={role} className="ab-team-card placeholder">
                <div className="ab-team-avatar" aria-hidden="true">
                  <PlusIcon className="ab-icon ab-icon-xl" />
                </div>
                <div className="ab-team-name">{t("public.about.team.placeholderName")}</div>
                <div className="ab-team-role">{t(role)}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — join as contributor ──────────────────────────────── */}
      <section className="ab-cta" aria-labelledby="ab-cta-title">
        <div className="ab-container">
          <div className="ab-cta-inner">
            <span className="ab-cta-eyebrow">
              <CodeIcon className="ab-icon ab-icon-sm" />
              {t("public.about.cta.eyebrow")}
            </span>

            <h2 className="ab-cta-title" id="ab-cta-title">
              {t("public.about.cta.title")}{" "}
              <span className="ab-soft">{t("public.about.cta.titleSoft")}</span>
            </h2>

            <p className="ab-cta-lede">{t("public.about.cta.lede")}</p>

            <div className="ab-cta-actions">
              <a className="ab-btn ab-btn-light ab-btn-xl" href={REPO_URL} rel="noopener" target="_blank">
                <GithubIcon className="ab-icon" />
                {t("public.about.cta.github")}
              </a>
              <Link className="ab-btn ab-btn-outline-light ab-btn-xl" to="/contact">
                {t("public.about.cta.contact")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
