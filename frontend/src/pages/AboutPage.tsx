import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { SeoHead } from "@/components/public/SeoHead";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  EyeIcon,
  GithubIcon,
  HeartIcon,
  LockIcon,
  PlusIcon,
  ShieldIcon,
  StarIcon,
} from "@/components/public/icons";
import {
  BTN_LIGHT,
  BTN_OUTLINE_LIGHT,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CtaBand,
  Eyebrow,
  Hero,
  Section,
  SectionHead,
} from "@/components/public/ui";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";

/**
 * W-02 — About (/about). Story phases, vision/mission, values, the
 * hadith centerpiece with a brief tafsir, the open-source rationale,
 * the founder, and a forming-team grid. No real-child imagery — the
 * founder/team avatars are typographic placeholders only.
 *
 * Rendered inside PublicSiteLayout (shared PublicNav + PublicFooter
 * shell, no auth), so this returns page content only.
 */
export function AboutPage() {
  const { t } = useTranslation();

  const phases = [1, 2, 3] as const;
  const values = [
    { name: "about.values.v1Name", desc: "about.values.v1Desc", Icon: StarIcon },
    { name: "about.values.v2Name", desc: "about.values.v2Desc", Icon: LockIcon },
    { name: "about.values.v3Name", desc: "about.values.v3Desc", Icon: HeartIcon },
    { name: "about.values.v4Name", desc: "about.values.v4Desc", Icon: CheckIcon },
  ];
  const osPoints = [
    "public.about.os.point1",
    "public.about.os.point2",
    "public.about.os.point3",
    "public.about.os.point4",
  ];
  const teamRoles = [
    "about.team.role1",
    "about.team.role2",
    "about.team.role3",
    "about.team.role4",
    "about.team.role5",
  ];

  return (
    <>
      <SeoHead titleKey="public.about.meta.title" descriptionKey="public.about.meta.description" />
      <Hero
          eyebrow={
            <>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success-500" />
              {t("public.about.hero.eyebrow")}
            </>
          }
          title={t("public.about.hero.title")}
          titleAccent={t("public.about.hero.titleAccent")}
          subtitle={t("public.about.hero.subtitle")}
        >
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon className="h-4 w-4 text-trust-400" />
              {t("public.about.hero.metaFounded")}
            </span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gray-300" />
            <span className="inline-flex items-center gap-1.5">
              <CodeIcon className="h-4 w-4 text-trust-400" />
              {t("public.about.hero.metaOpenSource")}
            </span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gray-300" />
            <span className="inline-flex items-center gap-1.5">
              <StarIcon className="h-4 w-4 text-trust-400" />
              {t("public.about.hero.metaWaqf")}
            </span>
          </div>
        </Hero>

        {/* STORY */}
        <Section labelledBy="story-title">
          <SectionHead
            id="story-title"
            eyebrow={t("public.about.story.eyebrow")}
            title={t("public.about.story.title")}
            titleAccent={t("public.about.story.titleAccent")}
            lede={t("public.about.story.lede")}
          />
          <div className="grid gap-6 md:grid-cols-3">
            {phases.map((n) => (
              <article
                key={n}
                className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white p-7 text-center transition hover:border-sky-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-sky-200 text-trust-500">
                  <ShieldIcon className="h-7 w-7" />
                  <span className="absolute -bottom-2.5 rounded-full border-2 border-snow-100 bg-trust-500 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white tabular-nums dark:border-gray-800">
                    {t(`public.about.story.phase${n}Year`)}
                  </span>
                </div>
                <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t(`public.about.story.phase${n}Title`)}
                </h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  {t(`public.about.story.phase${n}Desc`)}
                </p>
              </article>
            ))}
          </div>
        </Section>

        {/* VISION + MISSION */}
        <Section labelledBy="vm-title" className="border-y border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/40">
          <SectionHead
            id="vm-title"
            eyebrow={t("public.about.vm.eyebrow")}
            title={t("public.about.vm.title")}
            titleAccent={t("public.about.vm.titleAccent")}
          />
          <div className="grid gap-6 md:grid-cols-2">
            {(["vision", "mission"] as const).map((k) => (
              <article
                key={k}
                className="rounded-3xl border border-sky-200 bg-snow-100 p-8 transition hover:border-trust-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
              >
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                  {k === "vision" ? <EyeIcon className="h-6 w-6" /> : <ClockIcon className="h-6 w-6" />}
                </div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-trust-500">
                  {t(`public.about.vm.${k}Label`)}
                </div>
                <h3 className="mb-3.5 text-2xl font-semibold leading-snug text-gray-900 dark:text-gray-100">
                  {t(`public.about.vm.${k}Title`)}
                </h3>
                <p className="leading-relaxed text-gray-600 dark:text-gray-300">
                  {t(`public.about.vm.${k}Body`)}
                </p>
              </article>
            ))}
          </div>
        </Section>

        {/* VALUES */}
        <Section labelledBy="values-title">
          <SectionHead
            id="values-title"
            eyebrow={t("public.about.values.eyebrow")}
            title={t("public.about.values.title")}
            titleAccent={t("public.about.values.titleAccent")}
            lede={t("public.about.values.lede")}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {values.map(({ name, desc, Icon }) => (
              <article
                key={name}
                className="rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-sky-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-lg bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
                  {t(name)}
                </h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{t(desc)}</p>
              </article>
            ))}
          </div>
        </Section>

        {/* HADITH + TAFSIR */}
        <Section labelledBy="hadith-title" className="border-y border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/40">
          <SectionHead
            id="hadith-title"
            eyebrow={t("public.about.hadith.eyebrow")}
            title={t("public.about.hadith.title")}
            titleAccent={t("public.about.hadith.titleAccent")}
          />
          <div className="mx-auto max-w-3xl rounded-3xl border border-sky-200 bg-gradient-to-bl from-tranquil-100 to-snow-200 p-8 sm:p-10 dark:border-gray-700 dark:from-gray-900 dark:to-gray-800">
            <p className="text-center text-2xl font-medium leading-relaxed text-trust-700 sm:text-3xl dark:text-trust-100">
              ﴾ {t("public.about.hadith.text")} ﴿
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 text-center text-sm font-medium text-trust-500">
              <span>{t("public.about.hadith.source")}</span>
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-trust-300" />
              <span>{t("public.about.hadith.narrator")}</span>
            </div>
            <div className="mt-7 rounded-2xl border border-sky-200 bg-white p-5 sm:p-6 dark:border-gray-700 dark:bg-gray-900">
              <div className="mb-2.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-trust-500">
                <CodeIcon className="h-3.5 w-3.5" />
                {t("public.about.hadith.tafsirLabel")}
              </div>
              <p className="leading-loose text-gray-700 dark:text-gray-300">
                {t("public.about.hadith.tafsir")}
              </p>
            </div>
          </div>
        </Section>

        {/* OPEN SOURCE */}
        <Section labelledBy="os-title">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Eyebrow>{t("public.about.os.eyebrow")}</Eyebrow>
              <h2
                id="os-title"
                className="text-3xl font-semibold leading-tight tracking-tight text-gray-900 dark:text-gray-100"
              >
                {t("public.about.os.title")}{" "}
                <span className="text-trust-500">{t("public.about.os.titleAccent")}</span>
              </h2>
              <p className="leading-relaxed text-gray-600 dark:text-gray-300">
                {t("public.about.os.lede")}
              </p>
              <ul className="mt-2 flex flex-col gap-3">
                {osPoints.map((p) => (
                  <li key={p} className="grid grid-cols-[26px_1fr] items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-success-50 text-success-700">
                      <CheckIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                      {t(p)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <a href={REPO_URL} rel="noopener" target="_blank" className={`${BTN_PRIMARY} bg-gradient-to-bl from-gray-800 to-gray-900 hover:from-gray-900 hover:to-gray-900`}>
                  <GithubIcon className="h-4 w-4" />
                  {t("public.about.os.repoButton")}
                </a>
              </div>
            </div>

            {/* Decorative code-window — no fabricated star counts */}
            <div aria-hidden="true" className="rounded-3xl bg-gray-900 p-6 shadow-lg">
              <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3.5">
                <span className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success-500/70" />
                </span>
                <span className="ms-auto font-mono text-xs text-gray-400">
                  {t("public.about.os.windowTitle")}
                </span>
              </div>
              <div className="mb-5 flex items-center gap-2 font-mono text-sm text-white">
                <GithubIcon className="h-4 w-4 text-trust-300" />
                samehshakeraly / rufaqaa-app
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(["stars", "forks", "contributors"] as const).map((s) => (
                  <div key={s} className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-3">
                    <div className="mb-1 text-[11px] text-gray-400">{t(`public.about.os.${s}`)}</div>
                    <div className="font-mono text-lg font-semibold text-white">MIT</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* FOUNDER */}
        <Section labelledBy="founder-title" className="border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/40">
          <SectionHead
            id="founder-title"
            eyebrow={t("public.about.founder.eyebrow")}
            title={t("public.about.founder.title")}
            titleAccent={t("public.about.founder.titleAccent")}
          />
          <article className="mx-auto grid max-w-4xl gap-8 rounded-3xl border border-sky-200 bg-snow-100 p-8 sm:grid-cols-[180px_1fr] sm:p-10 dark:border-gray-700 dark:bg-gray-900">
            <div
              aria-hidden="true"
              className="mx-auto flex h-44 w-44 items-center justify-center rounded-3xl border border-sky-200 bg-tranquil-100 text-6xl font-semibold text-trust-700 dark:border-gray-700 dark:bg-gray-800 dark:text-trust-100"
            >
              س ع
            </div>
            <div className="flex flex-col gap-2.5 text-center sm:text-start">
              <div className="text-xs font-semibold uppercase tracking-wide text-trust-500">
                {t("public.about.founder.label")}
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {t("public.about.founder.name")}
              </h3>
              <div className="text-sm font-medium text-trust-600">
                {t("public.about.founder.titleLine")}
              </div>
              <p className="mt-2 leading-loose text-gray-700 dark:text-gray-300">
                {t("public.about.founder.bio1")}
              </p>
              <p className="leading-loose text-gray-700 dark:text-gray-300">
                {t("public.about.founder.bio2")}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2.5 sm:justify-start">
                <a
                  href="https://github.com/samehshakeraly"
                  rel="noopener"
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs text-gray-700 transition hover:border-trust-300 hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  <GithubIcon className="h-3.5 w-3.5 text-trust-400" />
                  @samehshakeraly
                </a>
              </div>
            </div>
          </article>
        </Section>

        {/* TEAM */}
        <Section labelledBy="team-title">
          <div className="mb-12 flex flex-col items-center gap-3.5 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-100 bg-warning-50 px-2.5 py-1 text-[11px] font-medium text-warning-700">
              <PlusIcon className="h-3.5 w-3.5" />
              {t("public.about.team.badge")}
            </span>
            <h2 id="team-title" className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              {t("public.about.team.title")}{" "}
              <span className="text-trust-500">{t("public.about.team.titleAccent")}</span>
            </h2>
            <p className="mx-auto max-w-2xl leading-relaxed text-gray-600 dark:text-gray-300">
              {t("public.about.team.lede")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <article className="flex flex-col items-center gap-1.5 rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 flex h-[76px] w-[76px] items-center justify-center rounded-full border border-sky-200 bg-tranquil-100 text-2xl font-semibold text-trust-700 dark:border-gray-700 dark:bg-gray-700 dark:text-trust-100">
                س.ع
              </div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("public.about.team.leadName")}
              </div>
              <div className="text-xs text-gray-500">{t("public.about.team.leadRole")}</div>
            </article>
            {teamRoles.map((role) => (
              <article
                key={role}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-sky-300 bg-white p-6 text-center dark:border-gray-600 dark:bg-gray-800"
              >
                <div className="mb-2 flex h-[76px] w-[76px] items-center justify-center rounded-full border border-dashed border-gray-300 bg-gray-50 text-gray-400 dark:border-gray-600 dark:bg-gray-900">
                  <PlusIcon className="h-7 w-7" />
                </div>
                <div className="text-sm font-medium text-gray-500">
                  {t("public.about.team.placeholderName")}
                </div>
                <div className="text-xs italic text-gray-400">{t(role)}</div>
              </article>
            ))}
          </div>
        </Section>

        <CtaBand
          eyebrow={
            <>
              <CodeIcon className="h-4 w-4" />
              {t("public.about.cta.eyebrow")}
            </>
          }
          title={t("public.about.cta.title")}
          titleSoft={t("public.about.cta.titleSoft")}
          lede={t("public.about.cta.lede")}
          actions={
            <>
              <a href={REPO_URL} rel="noopener" target="_blank" className={BTN_LIGHT}>
                <GithubIcon className="h-5 w-5" />
                {t("public.about.cta.github")}
              </a>
              <Link to="/contact" className={BTN_OUTLINE_LIGHT}>
                {t("public.about.cta.contact")}
              </Link>
            </>
          }
        />

        {/* Sponsor / contact quick actions referenced by the brief */}
        <Section>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/orphans" className={BTN_PRIMARY}>
              <HeartIcon className="h-4 w-4" />
              {t("public.nav.donate")}
            </Link>
            <Link to="/contact" className={BTN_SECONDARY}>
              {t("public.nav.contact")}
            </Link>
          </div>
        </Section>
    </>
  );
}
