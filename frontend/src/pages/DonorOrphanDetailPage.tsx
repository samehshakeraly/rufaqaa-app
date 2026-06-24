import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import type { PublicOrphanDetail } from "@/lib/public";
import { getPublicOrphan } from "@/lib/public";
import type { ReportDonorRead } from "@/lib/reports";
import { listMyReports } from "@/lib/reports";
import type { Sponsorship } from "@/lib/sponsorships";
import { listMySponsorships } from "@/lib/sponsorships";

const JUZ_TOTAL = 30;

/** D-07 — the donor's "child journey" detail page.
 *
 * Route: /donor/orphans/:id  (:id is the orphan_id).
 *
 * The sponsorship is located inside the donor's own /me/sponsorships
 * list, so a donor can only ever reach a child they actually sponsor —
 * never another donor's orphan. The page is read-only: it consumes the
 * already-scoped, donor-safe `ReportDonorRead` projection (/me/reports)
 * and renders it as a warm, human story rather than raw data.
 *
 * Out of scope here: child photos (placeholder avatar only), donor↔staff
 * messaging, and the full payment-history money-trail view. */
export function DonorOrphanDetailPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id = "" } = useParams<{ id: string }>();

  const sponsorshipsQ = useQuery({
    queryKey: ["donor", "me", "portal-sponsorships"],
    queryFn: () => listMySponsorships({ limit: 100 }),
  });
  const reportsQ = useQuery({
    queryKey: ["donor", "me", "reports"],
    queryFn: () => listMyReports({ limit: 100 }),
  });

  const sponsorship = sponsorshipsQ.data?.items.find((s) => s.orphan_id === id);

  // Secondary, best-effort fetch for richer basic info. Sponsored
  // orphans may not be publicly browseable, so failures are ignored.
  const orphanInfoQ = useQuery({
    queryKey: ["public", "orphan", sponsorship?.orphan_code],
    queryFn: () => getPublicOrphan(sponsorship!.orphan_code!),
    enabled: !!sponsorship?.orphan_code,
    retry: false,
  });

  // Newest-first for the timeline; the journey strip / trends derive their
  // own chronological views from this list as needed.
  const reports = (reportsQ.data?.items ?? [])
    .filter((r) => r.orphan_id === id)
    .sort(
      (a, b) =>
        new Date(b.period_start).getTime() - new Date(a.period_start).getTime(),
    );

  if (sponsorshipsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (sponsorshipsQ.error) {
    return (
      <p
        role="alert"
        className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
      >
        {t("common.loadError")}
      </p>
    );
  }

  if (!sponsorship) {
    return (
      <div className="space-y-4">
        <Link to="/donor/orphans" className="text-sm text-trust-600 underline">
          ← {t("donor.orphanDetail.back")}
        </Link>
        <div className="card text-center text-gray-500 dark:text-gray-400">
          {t("donor.orphanDetail.notFound")}
        </div>
      </div>
    );
  }

  const info = orphanInfoQ.data;
  const name = sponsorship.orphan_name ?? info?.first_name ?? "—";

  return (
    <div className="space-y-6">
      <Link to="/donor/orphans" className="text-sm text-trust-600 underline">
        ← {t("donor.orphanDetail.back")}
      </Link>

      <StoryHeader name={name} sponsorship={sponsorship} info={info} />

      <JourneyStrip name={name} sponsorship={sponsorship} reports={reports} />

      <Timeline name={name} reports={reports} loading={reportsQ.isLoading} lang={lang} />

      <ProgressTrends reports={reports} lang={lang} />

      <SponsorshipCard sponsorship={sponsorship} lang={lang} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A) Story header                                                     */
/* ------------------------------------------------------------------ */

function StoryHeader({
  name,
  sponsorship,
  info,
}: {
  name: string;
  sponsorship: Sponsorship;
  info: PublicOrphanDetail | undefined;
}) {
  const { t } = useTranslation();
  return (
    <section className="card" aria-label={t("donorTimeline.storyTitle")}>
      <p className="text-xs font-medium uppercase tracking-wide text-trust-500">
        {t("donorTimeline.storyTitle")}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <PlaceholderAvatar />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {name}
          </h1>
          {sponsorship.orphan_code && (
            <p className="font-mono text-xs text-gray-500">
              {sponsorship.orphan_code}
            </p>
          )}
        </div>
      </div>

      {info && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label={t("donor.orphanDetail.age")}>
            {t("donor.orphanDetail.ageValue", { age: info.age_years })}
          </Field>
          <Field label={t("donor.orphanDetail.gender")}>
            {info.gender === "M"
              ? t("donor.orphanDetail.male")
              : t("donor.orphanDetail.female")}
          </Field>
          {info.country && (
            <Field label={t("donor.orphanDetail.country")}>{info.country}</Field>
          )}
          {info.education_stage && (
            <Field label={t("orphans.profile.educationStage")}>
              {t(`orphans.profile.educationStageOptions.${info.education_stage}`)}
            </Field>
          )}
          {info.quran_juz_memorized != null && info.quran_juz_memorized > 0 && (
            <Field label={t("orphans.profile.quranSection")}>
              <span className="flex flex-wrap items-center gap-1.5">
                {t("donor.orphanDetail.quranMemorized", {
                  n: info.quran_juz_memorized,
                })}
                {info.is_hafiz && (
                  <span className="rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-100">
                    {t("donor.orphanDetail.hafiz")}
                  </span>
                )}
              </span>
            </Field>
          )}
        </dl>
      )}

      {info?.aspiration && (
        <p className="mt-3 rounded-lg bg-tranquil-100 px-3 py-2 text-sm text-trust-800 dark:bg-trust-500/10 dark:text-tranquil-100">
          <span className="font-medium">
            {t("donor.orphanDetail.aspiration")}:{" "}
          </span>
          {info.aspiration}
        </p>
      )}
      {info?.short_description && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
          {info.short_description}
        </p>
      )}
      {info && info.tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {info.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-tranquil-200 px-2 py-0.5 text-xs font-medium text-trust-700 dark:bg-gray-700 dark:text-tranquil-200"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlaceholderAvatar() {
  return (
    <span
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-tranquil-200 text-trust-600 dark:bg-gray-700"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-8 w-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 19a7 7 0 0 1 14 0" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* B) Journey strip                                                    */
/* ------------------------------------------------------------------ */

function JourneyStrip({
  name,
  sponsorship,
  reports,
}: {
  name: string;
  sponsorship: Sponsorship;
  reports: ReportDonorRead[];
}) {
  const { t } = useTranslation();

  const since = humanDuration(sponsorship.start_date);
  const sinceText = since ? formatDuration(since, t) : null;

  // Qur'an progress: chronological reports that carry juz_memorized.
  const juzSeries = [...reports]
    .reverse()
    .map((r) => r.quran_progress?.juz_memorized)
    .filter((n): n is number => typeof n === "number");
  const latestJuz = juzSeries.length
    ? (juzSeries[juzSeries.length - 1] as number)
    : null;
  const juzGained =
    juzSeries.length >= 2
      ? (juzSeries[juzSeries.length - 1] as number) - (juzSeries[0] as number)
      : null;

  const latestRatingCode = reports
    .map((r) => r.educational_progress?.overall_rating)
    .find((v): v is NonNullable<typeof v> => !!v);

  const hasAny =
    sinceText !== null ||
    latestJuz !== null ||
    reports.length > 0 ||
    !!latestRatingCode;
  if (!hasAny) return null;

  return (
    <section className="card" aria-label={t("donorTimeline.journeyTitle", { name })}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorTimeline.journeyTitle", { name })}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sinceText && (
          <div className="panel">
            <p className="text-sm text-gray-700 dark:text-gray-200">
              {t("donorTimeline.sponsoringSince", { name, duration: sinceText })}
            </p>
          </div>
        )}

        {latestJuz !== null && (
          <div className="panel">
            <dt className="text-xs text-gray-500">
              {t("donorTimeline.quranProgressLabel")}
            </dt>
            <dd className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {t("donorTimeline.juzOfTotal", { n: latestJuz })}
            </dd>
            <ProgressBar value={latestJuz} max={JUZ_TOTAL} />
            {juzGained !== null && juzGained > 0 && (
              <p className="mt-1 text-xs font-medium text-success-700 dark:text-success-300">
                {t("donorTimeline.juzGained", { n: juzGained })}
              </p>
            )}
          </div>
        )}

        {reports.length > 0 && (
          <div className="panel">
            <dt className="text-xs text-gray-500">
              {t("donorTimeline.updatesReceived")}
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {reports.length}
            </dd>
          </div>
        )}

        {latestRatingCode && (
          <div className="panel">
            <dt className="text-xs text-gray-500">
              {t("donorTimeline.latestRating")}
            </dt>
            <dd className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
              {t(`orphanageManager.report.eduRatingOptions.${latestRatingCode}`)}
            </dd>
          </div>
        )}
      </div>
    </section>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div
      className="mt-2 h-2 w-full overflow-hidden rounded-full bg-tranquil-300/60 dark:bg-gray-700"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full bg-trust-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* C) Timeline                                                         */
/* ------------------------------------------------------------------ */

function Timeline({
  name,
  reports,
  loading,
  lang,
}: {
  name: string;
  reports: ReportDonorRead[];
  loading: boolean;
  lang: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4" aria-label={t("donorTimeline.timelineTitle")}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorTimeline.timelineTitle")}
      </h2>

      {loading && <Skeleton className="h-40 w-full" />}

      {!loading && reports.length === 0 && (
        <div className="card text-center">
          <p className="font-medium text-gray-700 dark:text-gray-200">
            {t("donorTimeline.emptyTitle")}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("donorTimeline.emptyBody", { name })}
          </p>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <ol className="space-y-4 border-s-2 border-sky-200 ps-4 dark:border-gray-700">
          {reports.map((r) => (
            <TimelineCard key={r.id} report={r} lang={lang} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineCard({ report, lang }: { report: ReportDonorRead; lang: string }) {
  const { t } = useTranslation();
  const provenanceDate =
    report.published_at ??
    report.org_approved_at ??
    report.partner_approved_at ??
    report.submitted_at;

  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className={`absolute -start-[1.45rem] top-2 h-3 w-3 rounded-full ring-2 ring-white dark:ring-gray-800 ${
          report.is_milestone ? "bg-success-500" : "bg-trust-400"
        }`}
      />
      <article
        className={
          report.is_milestone
            ? "card border-2 border-success-300 bg-success-50/60 dark:border-success-500/40 dark:bg-success-500/5"
            : "card"
        }
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-tranquil-200 px-2 py-0.5 text-xs font-medium text-trust-700 dark:bg-gray-700 dark:text-tranquil-200">
            {t(`orphanageManager.report.reportTypeOptions.${report.report_type}`, {
              defaultValue: report.report_type,
            })}
          </span>
          <span className="text-xs text-gray-500">
            {formatDate(report.period_start, lang)} –{" "}
            {formatDate(report.period_end, lang)}
          </span>
          {report.is_milestone && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-100">
              <StarIcon />
              {report.milestone_label || t("donorTimeline.milestoneBadge")}
            </span>
          )}
        </header>

        {provenanceDate && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-trust-50 px-2 py-0.5 text-xs text-trust-700 dark:bg-trust-500/10 dark:text-tranquil-200">
            <CheckIcon />
            {t("donorTimeline.reviewedBadge")} · {formatDate(provenanceDate, lang)}
          </p>
        )}

        {report.summary && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-800 dark:text-gray-200">
            {report.summary}
          </p>
        )}

        {report.donor_message && (
          <blockquote className="mt-3 rounded-lg border-s-4 border-trust-300 bg-tranquil-100 px-3 py-2 dark:border-trust-500/40 dark:bg-trust-500/10">
            <p className="text-xs font-medium text-trust-600 dark:text-tranquil-200">
              {t("donorTimeline.supervisorNoteTitle")}
            </p>
            <p className="mt-1 whitespace-pre-line text-sm italic text-trust-800 dark:text-tranquil-100">
              “{report.donor_message}”
            </p>
          </blockquote>
        )}

        <SectionHighlights report={report} />
      </article>
    </li>
  );
}

function SectionHighlights({ report }: { report: ReportDonorRead }) {
  const { t } = useTranslation();
  const edu = report.educational_progress;
  const quran = report.quran_progress;
  const activities = report.activities;
  const health = report.health_status;
  const psych = report.psychological_status;

  const blocks: React.ReactNode[] = [];

  if (edu) {
    blocks.push(
      <SectionBlock key="edu" title={t("reports.sections.educational_progress")}>
        <div className="flex flex-wrap gap-1.5">
          {edu.overall_rating && (
            <Chip>
              {t(`orphanageManager.report.eduRatingOptions.${edu.overall_rating}`)}
            </Chip>
          )}
          {edu.attendance_percent != null && (
            <Chip>
              {t("donorTimeline.attendance", { percent: edu.attendance_percent })}
            </Chip>
          )}
          {edu.stage && (
            <Chip tone="muted">
              {t("donorTimeline.stageLabel")}: {edu.stage}
            </Chip>
          )}
          {edu.school_name && (
            <Chip tone="muted">
              {t("donorTimeline.schoolLabel")}: {edu.school_name}
            </Chip>
          )}
        </div>
        {edu.subjects && edu.subjects.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {edu.subjects.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className="rounded-md bg-tranquil-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700/60 dark:text-gray-200"
              >
                {s.name}
                {s.grade ? ` — ${s.grade}` : ""}
              </li>
            ))}
          </ul>
        )}
        <Note text={edu.note} />
      </SectionBlock>,
    );
  }

  if (quran) {
    blocks.push(
      <SectionBlock key="quran" title={t("reports.sections.quran_progress")}>
        <div className="flex flex-wrap gap-1.5">
          {quran.juz_memorized != null && (
            <Chip>{t("donorTimeline.juzMemorized", { n: quran.juz_memorized })}</Chip>
          )}
          {quran.current_juz != null && (
            <Chip tone="muted">
              {t("donorTimeline.currentJuz", { n: quran.current_juz })}
            </Chip>
          )}
          {quran.evaluation && (
            <Chip>
              {t(
                `orphanageManager.report.quranEvaluationOptions.${quran.evaluation}`,
              )}
            </Chip>
          )}
        </div>
        {quran.juz_memorized != null && (
          <ProgressBar value={quran.juz_memorized} max={JUZ_TOTAL} />
        )}
        {quran.recent && (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            <span className="text-gray-500">{t("donorTimeline.recentLabel")}: </span>
            {quran.recent}
          </p>
        )}
        <Note text={quran.note} />
      </SectionBlock>,
    );
  }

  if (activities) {
    blocks.push(
      <SectionBlock key="activities" title={t("reports.sections.activities")}>
        {activities.items && activities.items.length > 0 && (
          <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {activities.items.map((a, i) => (
              <li key={`${a.title}-${i}`} className="flex gap-2">
                <span aria-hidden="true" className="text-trust-400">
                  •
                </span>
                <span>
                  <span className="font-medium">{a.title}</span>
                  {a.note ? ` — ${a.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Note text={activities.note} />
      </SectionBlock>,
    );
  }

  if (health) {
    blocks.push(
      <SectionBlock key="health" title={t("reports.sections.health_status")}>
        {health.general && (
          <Chip>
            {t(`orphanageManager.report.healthGeneralOptions.${health.general}`)}
          </Chip>
        )}
        <Note text={health.note} />
      </SectionBlock>,
    );
  }

  if (psych) {
    blocks.push(
      <SectionBlock key="psych" title={t("reports.sections.psychological_status")}>
        <div className="flex flex-wrap gap-1.5">
          {psych.mood && (
            <Chip>{t(`orphanageManager.report.moodOptions.${psych.mood}`)}</Chip>
          )}
          {psych.social && (
            <Chip>
              {t(`orphanageManager.report.socialOptions.${psych.social}`)}
            </Chip>
          )}
        </div>
        <Note text={psych.note} />
      </SectionBlock>,
    );
  }

  if (blocks.length === 0) return null;
  return <div className="mt-4 space-y-3">{blocks}</div>;
}

function SectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: "accent" | "muted";
}) {
  const cls =
    tone === "accent"
      ? "bg-trust-100 text-trust-700 dark:bg-trust-500/15 dark:text-tranquil-100"
      : "bg-tranquil-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function Note({ text }: { text: string | null | undefined }) {
  const { t } = useTranslation();
  if (!text) return null;
  return (
    <p className="mt-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-400">
      <span className="text-gray-400">{t("donorTimeline.noteLabel")}: </span>
      {text}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* D) Progress trends (inline SVG sparklines)                          */
/* ------------------------------------------------------------------ */

function ProgressTrends({
  reports,
  lang,
}: {
  reports: ReportDonorRead[];
  lang: string;
}) {
  const { t } = useTranslation();

  // Chronological (oldest → newest) so the line reads left-to-right in time.
  const chrono = [...reports].reverse();
  const juz = chrono
    .map((r) => r.quran_progress?.juz_memorized)
    .filter((n): n is number => typeof n === "number");
  const attendance = chrono
    .map((r) => r.educational_progress?.attendance_percent)
    .filter((n): n is number => typeof n === "number");

  const showJuz = juz.length >= 2;
  const showAttendance = attendance.length >= 2;
  if (!showJuz && !showAttendance) return null;

  return (
    <section className="card space-y-4" aria-label={t("donorTimeline.trendsTitle")}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorTimeline.trendsTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {showJuz && (
          <figure>
            <figcaption className="mb-1 text-sm text-gray-600 dark:text-gray-300">
              {t("donorTimeline.trendJuz")}
            </figcaption>
            <Sparkline values={juz} max={JUZ_TOTAL} lang={lang} />
          </figure>
        )}
        {showAttendance && (
          <figure>
            <figcaption className="mb-1 text-sm text-gray-600 dark:text-gray-300">
              {t("donorTimeline.trendAttendance")}
            </figcaption>
            <Sparkline values={attendance} max={100} lang={lang} />
          </figure>
        )}
      </div>
    </section>
  );
}

function Sparkline({
  values,
  max,
  lang,
}: {
  values: number[];
  max: number;
  lang: string;
}) {
  const W = 160;
  const H = 40;
  const PAD = 4;
  const n = values.length;
  const span = Math.max(1, max);
  const points = values.map((v, i) => {
    const x = PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
    const y = H - PAD - (Math.max(0, Math.min(span, v)) / span) * (H - 2 * PAD);
    return [x, y] as const;
  });
  const path = points.map(([x, y]) => `${x},${y}`).join(" ");
  const last = points[points.length - 1] ?? ([PAD, H - PAD] as const);
  const latest = values[values.length - 1] ?? 0;

  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-10 w-40"
        role="img"
        preserveAspectRatio="none"
      >
        <polyline
          points={path}
          fill="none"
          className="stroke-trust-500"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last[0]} cy={last[1]} r="2.5" className="fill-trust-600" />
      </svg>
      <span className="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
        {latest.toLocaleString(lang)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* E) Sponsorship card                                                 */
/* ------------------------------------------------------------------ */

function SponsorshipCard({
  sponsorship,
  lang,
}: {
  sponsorship: Sponsorship;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="card space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorTimeline.sponsorshipTitle")}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label={t("donor.sponsorships.status")}>
          {t(`sponsorships.statuses.${sponsorship.status}`, sponsorship.status)}
        </Stat>
        <Stat label={t("donor.orphanDetail.monthlyAmount")}>
          <span className="tabular-nums">
            {sponsorship.monthly_amount} {sponsorship.currency}
          </span>
        </Stat>
        <Stat label={t("donor.orphanDetail.nextPayment")}>
          {sponsorship.next_payment_date
            ? formatDate(sponsorship.next_payment_date, lang)
            : t("donor.orphanDetail.notScheduled")}
        </Stat>
        <Stat label={t("donor.orphanDetail.totalPaid")}>
          <span className="tabular-nums">
            {sponsorship.total_paid} {sponsorship.currency}
          </span>
        </Stat>
        <Stat label={t("donorTimeline.startDateLabel")}>
          {formatDate(sponsorship.start_date, lang)}
        </Stat>
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces + helpers                                       */
/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
        {children}
      </dd>
    </div>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.9 6.3 6.9.7-5.1 4.7 1.4 6.8L12 17.8 5.9 21.2l1.4-6.8L2.2 9.7l6.9-.7L12 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDate(value: string, lang: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface Duration {
  years: number;
  months: number;
}

/** Whole years + remaining months between `start` and now. Returns null
 * for an unparseable or future date. */
function humanDuration(start: string): Duration | null {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return null;
  const now = new Date();
  let months =
    (now.getFullYear() - from.getFullYear()) * 12 +
    (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

function formatDuration(
  d: Duration,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (d.years > 0 && d.months > 0)
    return t("donorTimeline.durationYearsMonths", {
      years: d.years,
      months: d.months,
    });
  if (d.years > 0) return t("donorTimeline.durationYears", { years: d.years });
  if (d.months > 0) return t("donorTimeline.durationMonths", { months: d.months });
  return t("donorTimeline.durationNew");
}
