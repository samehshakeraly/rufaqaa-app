import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  BarChartIcon,
  BuildingIcon,
  CheckIcon,
  GlobeIcon,
  InfoIcon,
  MessageIcon,
  StarIcon,
} from "@/components/public/icons";
import {
  BTN_LIGHT,
  BTN_OUTLINE_LIGHT,
  BTN_PRIMARY,
  CtaBand,
  Hero,
  Section,
  SectionHead,
} from "@/components/public/ui";

/**
 * W-05 — Partners (/partners). Verified partner-organization cards,
 * how-to-join steps, partner benefits, and a closing CTA.
 *
 * IMPORTANT: partner names are NOT hard-coded. Sameh hasn't confirmed
 * consent from the real organizations yet, so every card uses the
 * `public.partners.list.placeholderName` i18n key rendered as
 * "شريك ١" / "Partner 1". Figures are shown as "—" placeholders for the
 * same reason. Pending owner decision — swap in real names/figures only
 * after each organization confirms consent.
 * Rendered inside PublicSiteLayout — content only.
 */
export function PublicPartnersPage() {
  const { t } = useTranslation();

  const partnerCount = 6;
  const joinSteps = [1, 2, 3, 4, 5] as const;
  const benefits = [
    { t: "b1Title", d: "b1Desc" },
    { t: "b2Title", d: "b2Desc" },
    { t: "b3Title", d: "b3Desc" },
    { t: "b4Title", d: "b4Desc" },
  ];

  return (
    <>
      <SeoHead
        titleKey="public.partners.meta.title"
        descriptionKey="public.partners.meta.description"
      />
      <Hero
        eyebrow={
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success-500" />
            {t("public.partners.hero.eyebrow")}
          </>
        }
        title={t("public.partners.hero.title")}
        titleAccent={t("public.partners.hero.titleAccent")}
        subtitle={t("public.partners.hero.subtitle")}
      />

      {/* PARTNER LIST (placeholder names — pending consent) */}
      <Section labelledBy="partners-list-title">
        <SectionHead
          id="partners-list-title"
          eyebrow={t("public.partners.list.eyebrow")}
          title={t("public.partners.list.title")}
          titleAccent={t("public.partners.list.titleAccent")}
          lede={t("public.partners.list.lede")}
        />
        <div className="mx-auto mb-8 flex max-w-2xl items-start gap-2.5 rounded-xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <InfoIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{t("public.partners.list.placeholderNote")}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: partnerCount }, (_, i) => i + 1).map((n) => (
            <article
              key={n}
              className="rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-sky-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-4 flex items-start gap-3">
                <div
                  aria-hidden="true"
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-tranquil-200 text-trust-600 dark:bg-gray-700"
                >
                  <BuildingIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">
                    {/* Placeholder name — pending owner decision on real orgs */}
                    {t("public.partners.list.placeholderName")} {n}
                  </div>
                  <div className="text-xs text-gray-500">{t("public.partners.list.country")}</div>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-700">
                  <CheckIcon className="h-3 w-3" />
                  {t("public.partners.list.verified")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
                <div>
                  <div className="text-xs text-gray-500">
                    {t("public.partners.list.orphansLabel")}
                  </div>
                  <div className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">—</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t("public.partners.list.sinceLabel")}</div>
                  <div className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">—</div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs text-gray-500">
                <CheckIcon className="h-3.5 w-3.5 text-success-600" />
                {t("public.partners.list.licensed")}
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* JOIN */}
      <Section id="join" labelledBy="join-title" className="bg-white dark:bg-gray-800/40">
        <SectionHead
          id="join-title"
          eyebrow={t("public.partners.join.eyebrow")}
          title={t("public.partners.join.title")}
          titleAccent={t("public.partners.join.titleAccent")}
          lede={t("public.partners.join.lede")}
        />
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-5 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t("public.partners.join.stepsTitle")}
            </h3>
            <ol className="flex flex-col gap-3">
              {joinSteps.map((n) => (
                <li
                  key={n}
                  className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-900"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-trust-500 font-semibold tabular-nums text-white">
                    {n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                      {t(`public.partners.join.s${n}Title`)}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      {t(`public.partners.join.s${n}Desc`)}
                    </div>
                  </div>
                  <span className="flex-shrink-0 rounded-full bg-tranquil-100 px-2.5 py-1 text-[11px] font-medium text-trust-600 tabular-nums dark:bg-gray-700 dark:text-trust-100">
                    {t(`public.partners.join.s${n}Dur`)}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-6">
              <Link to="/contact" className={BTN_PRIMARY}>
                {t("public.partners.join.startButton")}
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-sky-200 bg-snow-100 p-7 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-5 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              <StarIcon className="h-5 w-5 text-trust-500" />
              {t("public.partners.join.benefitsTitle")}
            </div>
            <ul className="flex flex-col gap-4">
              {benefits.map(({ t: tt, d }, i) => (
                <li key={tt} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                    {
                      [
                        <CheckIcon key="c" className="h-4 w-4" />,
                        <MessageIcon key="m" className="h-4 w-4" />,
                        <GlobeIcon key="g" className="h-4 w-4" />,
                        <BarChartIcon key="b" className="h-4 w-4" />,
                      ][i]
                    }
                  </span>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                      {t(`public.partners.join.${tt}`)}
                    </div>
                    <div className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                      {t(`public.partners.join.${d}`)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <CtaBand
        eyebrow={
          <>
            <BuildingIcon className="h-4 w-4" />
            {t("public.partners.cta.eyebrow")}
          </>
        }
        title={t("public.partners.cta.title")}
        titleSoft={t("public.partners.cta.titleSoft")}
        lede={t("public.partners.cta.lede")}
        actions={
          <>
            <a href="#join" className={BTN_LIGHT}>
              {t("public.partners.cta.join")}
            </a>
            <Link to="/contact" className={BTN_OUTLINE_LIGHT}>
              {t("public.partners.cta.question")}
            </Link>
          </>
        }
      />
    </>
  );
}
