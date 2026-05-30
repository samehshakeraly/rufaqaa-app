import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  BuildingIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  CreditCardIcon,
  FileTextIcon,
  HeartIcon,
  HomeIcon,
  LockIcon,
  NetworkIcon,
  SearchIcon,
  SendIcon,
  ShieldIcon,
  StarIcon,
  UsersIcon,
} from "@/components/public/icons";

import "./HowItWorksPage.css";

/**
 * W-03 — How It Works (/how-it-works). Pixel-matched to
 * docs/design/screens/public/W-03-HowItWorks.html, mirroring the
 * OA-01 scoped-CSS pattern: every style lives in HowItWorksPage.css
 * scoped under `.hw-root` and prefixed `hw-`. Shared nav/footer are
 * provided by PublicSiteLayout — only the page body is ported here.
 *
 * Static marketing content: no endpoints are wired. All copy comes
 * from i18n (public.how.*; FAQ band reuses public.contact.faq.*).
 */

type AudienceVariant = "donor" | "orphan" | "partner";

type StepNum = 1 | 2 | 3 | 4 | 5;

const STEP_NUMS: readonly StepNum[] = [1, 2, 3, 4, 5];

// Per-audience timeline step icons + chip variants (mirror mockup).
const AUDIENCES: ReadonlyArray<{
  key: "donors" | "orphansPath" | "partnersPath";
  anchor: string;
  variant: AudienceVariant;
  MarkIcon: (p: { className?: string }) => ReactNode;
  steps: ReadonlyArray<{
    StepIcon: (p: { className?: string }) => ReactNode;
    chip?: "duration" | "optional";
  }>;
}> = [
  {
    key: "donors",
    anchor: "for-donors",
    variant: "donor",
    MarkIcon: HeartIcon,
    steps: [
      { StepIcon: SearchIcon },
      { StepIcon: HeartIcon, chip: "duration" },
      { StepIcon: CreditCardIcon },
      { StepIcon: FileTextIcon },
      { StepIcon: SendIcon, chip: "optional" },
    ],
  },
  {
    key: "orphansPath",
    anchor: "for-orphans",
    variant: "orphan",
    MarkIcon: HomeIcon,
    steps: [
      { StepIcon: FileTextIcon },
      { StepIcon: CheckCircleIcon, chip: "duration" },
      { StepIcon: NetworkIcon },
      { StepIcon: CreditCardIcon },
      { StepIcon: StarIcon, chip: "duration" },
    ],
  },
  {
    key: "partnersPath",
    anchor: "for-partners",
    variant: "partner",
    MarkIcon: BuildingIcon,
    steps: [
      { StepIcon: FileTextIcon },
      { StepIcon: CheckCircleIcon, chip: "duration" },
      { StepIcon: UsersIcon },
      { StepIcon: CreditCardIcon },
      { StepIcon: CheckIcon, chip: "duration" },
    ],
  },
];

// Money-flow nodes (5 stops) + connecting arrows (4 labels).
const FLOW_NODES: ReadonlyArray<{
  n: 1 | 2 | 3 | 4 | 5;
  NodeIcon: (p: { className?: string }) => ReactNode;
  variant?: "center" | "orphan-node";
  latinLabel?: boolean;
}> = [
  { n: 1, NodeIcon: UsersIcon },
  { n: 2, NodeIcon: CreditCardIcon, latinLabel: true },
  { n: 3, NodeIcon: CheckCircleIcon, variant: "center" },
  { n: 4, NodeIcon: BuildingIcon },
  { n: 5, NodeIcon: HomeIcon, variant: "orphan-node" },
];

const FLOW_NOTES: ReadonlyArray<{
  t: string;
  d: string;
  NoteIcon: (p: { className?: string }) => ReactNode;
}> = [
  { t: "note1Title", d: "note1Desc", NoteIcon: LockIcon },
  { t: "note2Title", d: "note2Desc", NoteIcon: ClockIcon },
  { t: "note3Title", d: "note3Desc", NoteIcon: CheckCircleIcon },
  { t: "note4Title", d: "note4Desc", NoteIcon: StarIcon },
];

const SECURITY_CARDS: ReadonlyArray<{
  t: string;
  d: string;
  c: string;
  CardIcon: (p: { className?: string }) => ReactNode;
}> = [
  { t: "c1Title", d: "c1Desc", c: "c1Chip", CardIcon: LockIcon },
  { t: "c2Title", d: "c2Desc", c: "c2Chip", CardIcon: ShieldIcon },
  { t: "c3Title", d: "c3Desc", c: "c3Chip", CardIcon: CheckCircleIcon },
  { t: "c4Title", d: "c4Desc", c: "c4Chip", CardIcon: CodeIcon },
];

export function HowItWorksPage() {
  const { t } = useTranslation();

  return (
    <div className="hw-root">
      <SeoHead titleKey="public.how.meta.title" descriptionKey="public.how.meta.description" />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="hw-hero" aria-labelledby="hw-hero-title">
        <div className="hw-container hw-hero-inner">
          <span className="hw-eyebrow">
            <span className="hw-dot" aria-hidden="true" />
            {t("public.how.hero.eyebrow")}
          </span>

          <h1 className="hw-hero-title" id="hw-hero-title">
            {t("public.how.hero.title")}{" "}
            <span className="hw-accent">{t("public.how.hero.titleAccent")}</span>
          </h1>

          <p className="hw-hero-sub">{t("public.how.hero.subtitle")}</p>

          <nav
            className="hw-role-jump"
            aria-label={t("public.how.hero.eyebrow")}
          >
            <a className="hw-role-pill" href="#for-donors">
              <HeartIcon className="hw-icon hw-icon-sm" />
              {t("public.how.hero.jumpDonors")}
            </a>
            <a className="hw-role-pill" href="#for-orphans">
              <HomeIcon className="hw-icon hw-icon-sm" />
              {t("public.how.hero.jumpOrphans")}
            </a>
            <a className="hw-role-pill" href="#for-partners">
              <BuildingIcon className="hw-icon hw-icon-sm" />
              {t("public.how.hero.jumpPartners")}
            </a>
            <a className="hw-role-pill" href="#flow">
              <NetworkIcon className="hw-icon hw-icon-sm" />
              {t("public.how.hero.jumpMoney")}
            </a>
          </nav>
        </div>
      </section>

      {/* ── AUDIENCE TIMELINES (sponsors / orphans / partners) ───── */}
      {AUDIENCES.map((aud, idx) => (
        <section
          key={aud.key}
          id={aud.anchor}
          aria-labelledby={`${aud.anchor}-title`}
          className={`hw-audience hw-audience-${aud.variant}${idx === 1 ? " hw-audience-alt" : ""}`}
        >
          <div className="hw-container">
            <div className="hw-audience-head">
              <div className={`hw-audience-mark hw-${aud.variant}`} aria-hidden="true">
                <aud.MarkIcon className="hw-icon hw-icon-xl" />
              </div>
              <div className="hw-audience-info">
                <div className="hw-audience-eyebrow">{t(`public.how.${aud.key}.eyebrow`)}</div>
                <h2 className="hw-audience-title" id={`${aud.anchor}-title`}>
                  {t(`public.how.${aud.key}.title`)}
                </h2>
                <p className="hw-audience-sub">{t(`public.how.${aud.key}.subtitle`)}</p>
              </div>
              <div className="hw-audience-meta">
                <strong>{t(`public.how.${aud.key}.metaValue`)}</strong>
                <span>{t(`public.how.${aud.key}.metaLabel`)}</span>
              </div>
            </div>

            <ol className="hw-tl">
              {aud.steps.map((step, sIdx) => {
                const n = STEP_NUMS[sIdx];
                return (
                  <li key={n} className="hw-tl-step">
                    <div className="hw-tl-step-num hw-latin">{n}</div>
                    <div className="hw-tl-step-card">
                      <div className="hw-tl-step-body">
                        <div className="hw-tl-step-title">
                          {t(`public.how.${aud.key}.s${n}Title`)}
                          <span
                            className={`hw-micro-chip${step.chip ? ` hw-${step.chip}` : ""}`}
                          >
                            {t(`public.how.${aud.key}.s${n}Chip`)}
                          </span>
                        </div>
                        <div className="hw-tl-step-desc">
                          {t(`public.how.${aud.key}.s${n}Desc`)}
                        </div>
                      </div>
                      <div className="hw-tl-step-aside" aria-hidden="true">
                        <step.StepIcon className="hw-icon hw-icon-lg" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      ))}

      {/* ── MONEY FLOW ───────────────────────────────────────────── */}
      <section className="hw-flow" id="flow" aria-labelledby="hw-flow-title">
        <div className="hw-container">
          <div className="hw-section-head-center">
            <span className="hw-eyebrow">{t("public.how.flow.eyebrow")}</span>
            <h2 className="hw-section-title" id="hw-flow-title">
              {t("public.how.flow.title")}{" "}
              <span style={{ color: "var(--trust-500)" }}>
                {t("public.how.flow.titleAccent")}
              </span>
            </h2>
            <p className="hw-section-lede">{t("public.how.flow.lede")}</p>
          </div>

          <div className="hw-flow-diagram">
            <div className="hw-flow-row">
              {FLOW_NODES.map((node, i) => (
                <Fragment key={node.n}>
                  <div
                    className={`hw-flow-node${node.variant ? ` hw-${node.variant}` : ""}`}
                  >
                    <div className="hw-flow-node-icon">
                      <node.NodeIcon className="hw-icon hw-icon-xl" />
                    </div>
                    <div
                      className={`hw-flow-node-label${node.latinLabel ? " hw-latin" : ""}`}
                    >
                      {t(`public.how.flow.node${node.n}Label`)}
                    </div>
                    <div className="hw-flow-node-sub">
                      {t(`public.how.flow.node${node.n}Sub`)}
                    </div>
                  </div>
                  {i < FLOW_NODES.length - 1 && (
                    <div className="hw-flow-arrow" aria-hidden="true">
                      <div className="hw-flow-arrow-label">
                        {t(`public.how.flow.arrow${node.n}`)}
                      </div>
                      <div className="hw-flow-arrow-line" />
                    </div>
                  )}
                </Fragment>
              ))}
            </div>

            <div className="hw-flow-notes">
              {FLOW_NOTES.map(({ t: tt, d, NoteIcon }) => (
                <div key={tt} className="hw-flow-note">
                  <div className="hw-flow-note-icon" aria-hidden="true">
                    <NoteIcon className="hw-icon hw-icon-sm" />
                  </div>
                  <div>
                    <strong>{t(`public.how.flow.${tt}`)}</strong>
                    {t(`public.how.flow.${d}`)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECURITY & TRUST ─────────────────────────────────────── */}
      <section className="hw-security" aria-labelledby="hw-security-title">
        <div className="hw-container">
          <div className="hw-section-head-center">
            <span className="hw-eyebrow">{t("public.how.security.eyebrow")}</span>
            <h2 className="hw-section-title" id="hw-security-title">
              {t("public.how.security.title")}{" "}
              <span style={{ color: "var(--trust-500)" }}>
                {t("public.how.security.titleAccent")}
              </span>
            </h2>
            <p className="hw-section-lede">{t("public.how.security.lede")}</p>
          </div>

          <div className="hw-sec-grid">
            {SECURITY_CARDS.map(({ t: tt, d, c, CardIcon }) => (
              <article key={tt} className="hw-sec-card">
                <div className="hw-sec-icon" aria-hidden="true">
                  <CardIcon className="hw-icon hw-icon-lg" />
                </div>
                <h3 className="hw-sec-card-title">{t(`public.how.security.${tt}`)}</h3>
                <p className="hw-sec-card-desc">{t(`public.how.security.${d}`)}</p>
                <span className="hw-sec-card-chip">
                  <CheckIcon className="hw-icon hw-icon-sm" />
                  {t(`public.how.security.${c}`)}
                </span>
              </article>
            ))}
          </div>

          {/* FAQ snippet → W-06 (/contact). Reuses public.contact.faq.* */}
          <div className="hw-faq-band">
            <span className="hw-eyebrow">{t("public.contact.faq.eyebrow")}</span>
            <p>{t("public.contact.faq.lede")}</p>
            <Link to="/contact" className="hw-faq-link">
              <SearchIcon className="hw-icon hw-icon-sm" />
              {t("public.contact.faq.title")} {t("public.contact.faq.titleAccent")}
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="hw-cta" aria-labelledby="hw-cta-title">
        <div className="hw-container">
          <div className="hw-cta-inner">
            <span className="hw-cta-eyebrow">
              <CheckIcon className="hw-icon hw-icon-sm" />
              {t("public.how.cta.eyebrow")}
            </span>

            <h2 className="hw-cta-title" id="hw-cta-title">
              {t("public.how.cta.title")}{" "}
              <span className="hw-soft">{t("public.how.cta.titleSoft")}</span>
            </h2>

            <p className="hw-cta-lede">{t("public.how.cta.lede")}</p>

            <div className="hw-cta-actions">
              <Link to="/orphans" className="hw-btn hw-btn-light">
                <SearchIcon className="hw-icon" />
                {t("public.how.cta.browse")}
              </Link>
              <Link to="/contact" className="hw-btn hw-btn-outline-light">
                {t("public.how.cta.partner")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
