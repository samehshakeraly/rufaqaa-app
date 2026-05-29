import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  BuildingIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  CreditCardIcon,
  DollarIcon,
  HeartIcon,
  HomeIcon,
  LockIcon,
  SearchIcon,
  ShieldIcon,
} from "@/components/public/icons";
import {
  BTN_LIGHT,
  BTN_OUTLINE_LIGHT,
  CtaBand,
  Eyebrow,
  Hero,
  Section,
  SectionHead,
} from "@/components/public/ui";

/**
 * W-03 — How It Works (/how-it-works). Three role timelines (sponsors,
 * orphans/guardians, partners), the money-flow diagram, security/trust
 * cards, and a closing CTA. FAQ snippets link to W-06 (/contact).
 * Rendered inside PublicSiteLayout — content only.
 */
export function HowItWorksPage() {
  const { t } = useTranslation();

  const audiences = [
    { key: "donors", Icon: HeartIcon, anchor: "for-donors" },
    { key: "orphansPath", Icon: HomeIcon, anchor: "for-orphans" },
    { key: "partnersPath", Icon: BuildingIcon, anchor: "for-partners" },
  ] as const;

  const flowNodes = [1, 2, 3, 4, 5] as const;
  const flowNotes = [
    { t: "note1Title", d: "note1Desc", Icon: LockIcon },
    { t: "note2Title", d: "note2Desc", Icon: ClockIcon },
    { t: "note3Title", d: "note3Desc", Icon: CheckIcon },
    { t: "note4Title", d: "note4Desc", Icon: DollarIcon },
  ];
  const securityCards = [
    { t: "c1Title", d: "c1Desc", c: "c1Chip", Icon: LockIcon },
    { t: "c2Title", d: "c2Desc", c: "c2Chip", Icon: ShieldIcon },
    { t: "c3Title", d: "c3Desc", c: "c3Chip", Icon: CheckIcon },
    { t: "c4Title", d: "c4Desc", c: "c4Chip", Icon: CodeIcon },
  ];

  return (
    <>
      <SeoHead titleKey="public.how.meta.title" descriptionKey="public.how.meta.description" />
      <Hero
        eyebrow={
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success-500" />
            {t("public.how.hero.eyebrow")}
          </>
        }
        title={t("public.how.hero.title")}
        titleAccent={t("public.how.hero.titleAccent")}
        subtitle={t("public.how.hero.subtitle")}
      >
        <nav aria-label={t("public.how.hero.eyebrow")} className="mt-2 flex flex-wrap justify-center gap-2.5">
          {[
            { href: "#for-donors", label: "jumpDonors" },
            { href: "#for-orphans", label: "jumpOrphans" },
            { href: "#for-partners", label: "jumpPartners" },
            { href: "#flow", label: "jumpMoney" },
          ].map((p) => (
            <a
              key={p.href}
              href={p.href}
              className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-trust-600 transition hover:border-trust-300 hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-trust-100"
            >
              {t(`public.how.hero.${p.label}`)}
            </a>
          ))}
        </nav>
      </Hero>

      {audiences.map(({ key, Icon, anchor }, idx) => (
        <Section
          key={key}
          id={anchor}
          labelledBy={`${anchor}-title`}
          className={idx % 2 === 1 ? "bg-white dark:bg-gray-800/40" : ""}
        >
          <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-tranquil-200 text-trust-600 dark:bg-gray-700">
              <Icon className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-trust-500">
                {t(`public.how.${key}.eyebrow`)}
              </div>
              <h2
                id={`${anchor}-title`}
                className="text-2xl font-semibold text-gray-900 dark:text-gray-100"
              >
                {t(`public.how.${key}.title`)}
              </h2>
              <p className="mt-1.5 max-w-2xl leading-relaxed text-gray-600 dark:text-gray-300">
                {t(`public.how.${key}.subtitle`)}
              </p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-snow-100 px-4 py-3 text-center dark:border-gray-700 dark:bg-gray-900">
              <div className="font-semibold tabular-nums text-trust-600 dark:text-trust-100">
                {t(`public.how.${key}.metaValue`)}
              </div>
              <div className="text-xs text-gray-500">{t(`public.how.${key}.metaLabel`)}</div>
            </div>
          </div>

          <ol className="flex flex-col gap-4">
            {[1, 2, 3, 4, 5].map((n) => (
              <li
                key={n}
                className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-sky-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-trust-500 font-semibold tabular-nums text-white">
                  {n}
                </span>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      {t(`public.how.${key}.s${n}Title`)}
                    </h3>
                    <span className="rounded-full bg-tranquil-100 px-2 py-0.5 text-[11px] font-medium text-trust-600 dark:bg-gray-700 dark:text-trust-100">
                      {t(`public.how.${key}.s${n}Chip`)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                    {t(`public.how.${key}.s${n}Desc`)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ))}

      {/* MONEY FLOW */}
      <Section id="flow" labelledBy="flow-title" className="bg-white dark:bg-gray-800/40">
        <SectionHead
          id="flow-title"
          eyebrow={t("public.how.flow.eyebrow")}
          title={t("public.how.flow.title")}
          titleAccent={t("public.how.flow.titleAccent")}
          lede={t("public.how.flow.lede")}
        />
        <ol className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-between">
          {flowNodes.map((n, i) => (
            <li key={n} className="contents">
              <div
                className={`flex flex-col items-center gap-1.5 rounded-2xl border bg-snow-100 px-5 py-6 text-center lg:flex-1 dark:bg-gray-900 ${
                  n === 3
                    ? "border-trust-300 shadow-md"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                  {n === 1 ? (
                    <HeartIcon className="h-6 w-6" />
                  ) : n === 2 ? (
                    <CreditCardIcon className="h-6 w-6" />
                  ) : n === 3 ? (
                    <CheckIcon className="h-6 w-6" />
                  ) : n === 4 ? (
                    <BuildingIcon className="h-6 w-6" />
                  ) : (
                    <HomeIcon className="h-6 w-6" />
                  )}
                </div>
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  {t(`public.how.flow.node${n}Label`)}
                </div>
                <div className="text-xs text-gray-500">{t(`public.how.flow.node${n}Sub`)}</div>
              </div>
              {i < flowNodes.length - 1 && (
                <div className="flex items-center justify-center text-xs font-medium text-trust-500 lg:flex-col">
                  <span className="rounded-full bg-tranquil-100 px-2 py-0.5 dark:bg-gray-700">
                    {t(`public.how.flow.arrow${n}`)}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {flowNotes.map(({ t: tt, d, Icon }) => (
            <div
              key={tt}
              className="rounded-xl border border-sky-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                <strong className="font-semibold text-gray-900 dark:text-gray-100">
                  {t(`public.how.flow.${tt}`)}
                </strong>{" "}
                {t(`public.how.flow.${d}`)}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* SECURITY */}
      <Section labelledBy="security-title">
        <SectionHead
          id="security-title"
          eyebrow={t("public.how.security.eyebrow")}
          title={t("public.how.security.title")}
          titleAccent={t("public.how.security.titleAccent")}
          lede={t("public.how.security.lede")}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {securityCards.map(({ t: tt, d, c, Icon }) => (
            <article
              key={tt}
              className="rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-sky-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-lg bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="mb-1.5 font-semibold text-gray-900 dark:text-gray-100">
                {t(`public.how.security.${tt}`)}
              </h3>
              <p className="mb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {t(`public.how.security.${d}`)}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-[11px] font-medium text-success-700">
                <CheckIcon className="h-3.5 w-3.5" />
                {t(`public.how.security.${c}`)}
              </span>
            </article>
          ))}
        </div>
        {/* FAQ snippet linking to W-06 */}
        <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-sky-200 bg-tranquil-100 p-6 text-center dark:border-gray-700 dark:bg-gray-800">
          <Eyebrow>{t("public.contact.faq.eyebrow")}</Eyebrow>
          <p className="max-w-xl text-gray-700 dark:text-gray-200">
            {t("public.contact.faq.lede")}
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-xl border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-trust-600 transition hover:border-trust-300 dark:bg-gray-900 dark:text-trust-100"
          >
            <SearchIcon className="h-4 w-4" />
            {t("public.contact.faq.title")} {t("public.contact.faq.titleAccent")}
          </Link>
        </div>
      </Section>

      <CtaBand
        eyebrow={
          <>
            <CheckIcon className="h-4 w-4" />
            {t("public.how.cta.eyebrow")}
          </>
        }
        title={t("public.how.cta.title")}
        titleSoft={t("public.how.cta.titleSoft")}
        lede={t("public.how.cta.lede")}
        actions={
          <>
            <Link to="/orphans" className={BTN_LIGHT}>
              <SearchIcon className="h-5 w-5" />
              {t("public.how.cta.browse")}
            </Link>
            <Link to="/contact" className={BTN_OUTLINE_LIGHT}>
              {t("public.how.cta.partner")}
            </Link>
          </>
        }
      />
    </>
  );
}
