import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { SeoHead } from "@/components/public/SeoHead";
import {
  BarChartIcon,
  CheckCircleIcon,
  CodeIcon,
  CreditCardIcon,
  DollarIcon,
  GlobeIcon,
  HeartIcon,
  LockIcon,
  SearchIcon,
} from "@/components/public/icons";
import { Hero, Section, SectionHead } from "@/components/public/ui";
import { getPublicStats } from "@/lib/public";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";

/**
 * W-04 — Transparency (/transparency). Live platform stats from
 * GET /public/stats, the "where every dollar goes" allocation
 * breakdown (95 / 3 / 2, design-system colours only), transparency
 * commitments, and the open-source strip.
 *
 * The "recent transactions" feed is intentionally an empty/placeholder
 * state: /public/stats exposes aggregates only, never row-level
 * transactions, so we don't fabricate a feed. See the TODO below.
 * Rendered inside PublicSiteLayout — content only.
 */
export function TransparencyPage() {
  const { t } = useTranslation();
  const statsQ = useQuery({ queryKey: ["public", "stats"], queryFn: getPublicStats });

  const fmt = (v: number | undefined) =>
    v === undefined ? "—" : v.toLocaleString();

  const kpis = [
    { label: "sponsored", value: statsQ.data?.orphans_sponsored, Icon: HeartIcon, accent: true },
    { label: "available", value: statsQ.data?.orphans_available, Icon: SearchIcon },
    { label: "donors", value: statsQ.data?.donors_total, Icon: DollarIcon },
    { label: "countries", value: statsQ.data?.countries_served, Icon: GlobeIcon },
  ];

  // 95 / 3 / 2 split — design-system token colours only.
  const allocation = [
    { label: "toOrphans", pct: 95, stroke: "stroke-trust-300", swatch: "bg-trust-300" },
    { label: "operations", pct: 3, stroke: "stroke-sky-300", swatch: "bg-sky-300" },
    { label: "reserves", pct: 2, stroke: "stroke-tranquil-300", swatch: "bg-tranquil-300" },
  ];

  const commitments = [
    { t: "c1Title", d: "c1Desc", Icon: CheckCircleIcon },
    { t: "c2Title", d: "c2Desc", Icon: CodeIcon },
    { t: "c3Title", d: "c3Desc", Icon: LockIcon },
  ];

  return (
    <>
      <SeoHead
        titleKey="public.transparency.meta.title"
        descriptionKey="public.transparency.meta.description"
      />
      <Hero
        eyebrow={
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success-500" />
            {t("public.transparency.hero.eyebrow")}
          </>
        }
        title={t("public.transparency.hero.title")}
        titleAccent={t("public.transparency.hero.titleAccent")}
        subtitle={t("public.transparency.hero.subtitle")}
      >
        <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-success-100 bg-success-50 px-3 py-1.5 text-xs font-medium text-success-700">
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-success-500" />
          {t("public.transparency.hero.live")}
        </div>
      </Hero>

      {/* LIVE KPIs */}
      <Section labelledBy="kpi-title">
        <h2 id="kpi-title" className="sr-only">
          {t("public.transparency.kpi.heading")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(({ label, value, Icon, accent }) => (
            <div
              key={label}
              className="rounded-2xl border border-sky-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                <Icon className="h-5 w-5" />
              </div>
              <div
                className={`text-3xl font-bold tabular-nums ${
                  accent ? "text-trust-600 dark:text-trust-100" : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {statsQ.isLoading ? "…" : fmt(value)}
              </div>
              <div className="mt-1 text-sm text-gray-500">
                {t(`public.transparency.kpi.${label}`)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* FEED (placeholder) + ALLOCATION */}
      <Section className="bg-white dark:bg-gray-800/40">
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Recent transfers — placeholder, no fabricated data */}
          <div className="rounded-2xl border border-sky-200 bg-snow-100 p-6 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <CreditCardIcon className="h-4 w-4 text-trust-500" />
                {t("public.transparency.feed.title")}
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gray-300" />
                {t("public.transparency.feed.live")}
              </span>
            </div>
            {/*
              TODO(public): wire to a future public "recent transfers" endpoint.
              GET /public/stats returns aggregates only — never row-level
              transactions — so we render an honest placeholder instead of
              fabricating a feed. See public.transparency.feed.todo.
            */}
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-sky-300 bg-white px-6 py-12 text-center dark:border-gray-700 dark:bg-gray-800">
              <CreditCardIcon className="h-8 w-8 text-gray-300" />
              <p className="max-w-sm text-sm leading-relaxed text-gray-500">
                {t("public.transparency.feed.empty")}
              </p>
            </div>
          </div>

          {/* Allocation donut */}
          <aside className="rounded-2xl border border-sky-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <BarChartIcon className="h-4 w-4 text-trust-500" />
                {t("public.transparency.alloc.title")}
              </div>
              <span className="text-xs text-gray-500">{t("public.transparency.alloc.period")}</span>
            </div>
            <div className="relative mx-auto h-44 w-44">
              <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" role="img" aria-label={t("public.transparency.alloc.title")}>
                <circle
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="none"
                  className="stroke-tranquil-100"
                  strokeWidth="3.6"
                />
                {(() => {
                  let offset = 0;
                  return allocation.map((seg) => {
                    const dash = `${seg.pct} ${100 - seg.pct}`;
                    const el = (
                      <circle
                        key={seg.label}
                        cx="18"
                        cy="18"
                        r="15.915"
                        fill="none"
                        className={seg.stroke}
                        strokeWidth="3.6"
                        strokeDasharray={dash}
                        strokeDashoffset={-offset}
                      />
                    );
                    offset += seg.pct;
                    return el;
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-bold tabular-nums text-trust-600 dark:text-trust-100">
                  95%
                </div>
                <div className="text-xs text-gray-500">
                  {t("public.transparency.alloc.centerLabel")}
                </div>
              </div>
            </div>
            <ul className="mt-5 flex flex-col gap-2.5">
              {allocation.map((seg) => (
                <li key={seg.label} className="flex items-center gap-2.5 text-sm">
                  <span aria-hidden="true" className={`h-3 w-3 rounded-sm ${seg.swatch}`} />
                  <span className="flex-1 text-gray-700 dark:text-gray-300">
                    {t(`public.transparency.alloc.${seg.label}`)}
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {seg.pct}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-gray-500">
              {t("public.transparency.alloc.footer")}
            </p>
          </aside>
        </div>
      </Section>

      {/* ANNUAL REPORTS (pending) */}
      <Section labelledBy="reports-title">
        <SectionHead
          id="reports-title"
          eyebrow={t("public.transparency.reports.eyebrow")}
          title={t("public.transparency.reports.title")}
          titleAccent={t("public.transparency.reports.titleAccent")}
          lede={t("public.transparency.reports.lede")}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {[2023, 2024, 2025].map((year) => (
            <article
              key={year}
              className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="font-mono text-2xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                  {year}
                </div>
                <span className="rounded-full bg-warning-50 px-2.5 py-1 text-[11px] font-medium text-warning-700">
                  {t("public.transparency.reports.pending")}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-gray-500">
                {t("public.transparency.reports.pendingNote")}
              </p>
            </article>
          ))}
        </div>
      </Section>

      {/* COMMITMENTS */}
      <Section labelledBy="commitments-title" className="bg-white dark:bg-gray-800/40">
        <SectionHead
          id="commitments-title"
          eyebrow={t("public.transparency.commitments.eyebrow")}
          title={t("public.transparency.commitments.title")}
          titleAccent={t("public.transparency.commitments.titleAccent")}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {commitments.map(({ t: tt, d, Icon }) => (
            <article
              key={tt}
              className="rounded-2xl border border-gray-200 bg-snow-100 p-6 dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-lg bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="mb-1.5 font-semibold text-gray-900 dark:text-gray-100">
                {t(`public.transparency.commitments.${tt}`)}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {t(`public.transparency.commitments.${d}`)}
              </p>
            </article>
          ))}
        </div>
      </Section>

      {/* OPEN SOURCE STRIP */}
      <Section labelledBy="os-strip-title">
        <div className="rounded-3xl bg-gray-900 p-8 sm:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-tranquil-200">
                <CodeIcon className="h-3.5 w-3.5" />
                {t("public.transparency.os.eyebrow")}
              </span>
              <h2
                id="os-strip-title"
                className="mt-3 text-2xl font-semibold leading-snug text-white"
              >
                {t("public.transparency.os.title")}
              </h2>
              <p className="mt-2 max-w-xl leading-relaxed text-white/75">
                {t("public.transparency.os.subtitle")}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  href={REPO_URL}
                  rel="noopener"
                  target="_blank"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 font-mono text-sm font-medium text-gray-900 transition hover:bg-tranquil-100"
                >
                  <CodeIcon className="h-4 w-4" />
                  {t("public.transparency.os.repoButton")}
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["stars", "forks", "contributors", "commits"] as const).map((s) => (
                <div key={s} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
                  <div className="font-mono text-lg font-semibold text-white">MIT</div>
                  <div className="mt-0.5 text-[11px] text-gray-400">
                    {t(`public.transparency.os.${s}`)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="sr-only">{t("public.transparency.feed.todo")}</p>
      </Section>
    </>
  );
}
