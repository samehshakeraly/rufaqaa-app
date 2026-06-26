import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { countryName } from "@/lib/countries";
import { formatDate, formatDuration, humanDuration } from "@/lib/format";
import type { PaymentDonorRead } from "@/lib/payments";
import { listMyPayments } from "@/lib/payments";
import type { PublicOrphanDetail } from "@/lib/public";
import { getSponsoredOrphanProfile } from "@/lib/public";
import type { ReportDonorRead } from "@/lib/reports";
import { listMyReports } from "@/lib/reports";
import type { Sponsorship } from "@/lib/sponsorships";
import { listMySponsorships } from "@/lib/sponsorships";

const JUZ_TOTAL = 30;

/* ------------------------------------------------------------------ */
/* Meaning-driven color system                                         */
/* ------------------------------------------------------------------ */
//
// One semantic vocabulary, reused by the journey tiles AND the timeline
// chips: a child's status code maps to a token, never to a raw hex. We
// stay on the hopeful/respectful side of the palette — `warning` (amber)
// is the lowest tone we use for a child's standing; alarmist `danger`
// red is reserved for genuine failures (e.g. a failed payment), never
// for "needs support".

type Tone = "success" | "trust" | "sky" | "warning" | "gray";

/** Pill / chip surface for each tone (light + dark), accessible contrast. */
const TONE_CHIP: Record<Tone, string> = {
  success:
    "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  trust: "bg-trust-100 text-trust-700 dark:bg-trust-500/20 dark:text-tranquil-100",
  sky: "bg-sky-100 text-trust-700 dark:bg-sky-400/20 dark:text-tranquil-100",
  warning:
    "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  gray: "bg-tranquil-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
};

/** Larger tinted stat-tile surface (border + background) for each tone. */
const TONE_TILE: Record<Tone, string> = {
  success:
    "border-success-100 bg-success-50 dark:border-success-500/30 dark:bg-success-500/10",
  trust:
    "border-trust-200 bg-tranquil-100 dark:border-trust-500/30 dark:bg-trust-500/10",
  sky: "border-sky-200 bg-sky-100 dark:border-sky-400/30 dark:bg-sky-400/10",
  warning:
    "border-warning-100 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10",
  gray: "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60",
};

/** Solid SVG stroke per tone (for inline progress visuals). */
const TONE_STROKE: Record<Tone, string> = {
  success: "stroke-success-500",
  trust: "stroke-trust-500",
  sky: "stroke-sky-400",
  warning: "stroke-warning-500",
  gray: "stroke-gray-400",
};

const EDU_RATING_TONE: Record<string, Tone> = {
  excellent: "success",
  very_good: "trust",
  good: "sky",
  fair: "warning",
  needs_support: "warning",
};

const QURAN_EVAL_TONE: Record<string, Tone> = {
  mastered: "success",
  very_good: "trust",
  good: "sky",
  needs_review: "warning",
};

const HEALTH_TONE: Record<string, Tone> = {
  good: "success",
  stable: "success",
  monitored: "warning",
  needs_attention: "warning",
};

const MOOD_TONE: Record<string, Tone> = {
  good: "success",
  okay: "sky",
  needs_attention: "warning",
};

const SOCIAL_TONE: Record<string, Tone> = {
  excellent: "success",
  good: "trust",
  improving: "sky",
  needs_support: "warning",
};

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
 * Out of scope here: child photos (privacy — a monogram avatar stands in)
 * and donor↔staff messaging. */
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
  const paymentsQ = useQuery({
    queryKey: ["donor", "me", "payments", id],
    queryFn: () => listMyPayments({ orphanId: id, limit: 100 }),
    enabled: !!id,
  });

  const sponsorship = sponsorshipsQ.data?.items.find((s) => s.orphan_id === id);

  // Secondary, best-effort fetch for richer basic info. Scoped by the
  // donor's own sponsorship (keyed by orphan id), so it resolves even
  // for a sponsored child that is no longer publicly browseable. If it
  // fails, the timeline / cards still render and the name falls back.
  const orphanInfoQ = useQuery({
    queryKey: ["donor", "me", "orphanProfile", id],
    queryFn: () => getSponsoredOrphanProfile(id!),
    enabled: !!id,
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

      <StoryHeader name={name} sponsorship={sponsorship} info={info} lang={lang} />

      <JourneyStrip name={name} sponsorship={sponsorship} reports={reports} />

      <Timeline name={name} reports={reports} loading={reportsQ.isLoading} lang={lang} />

      <ProgressTrends reports={reports} lang={lang} />

      <SponsorshipCard sponsorship={sponsorship} lang={lang} />

      <MoneyTrail
        sponsorship={sponsorship}
        payments={paymentsQ.data?.items ?? []}
        loading={paymentsQ.isLoading}
        lang={lang}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A) Story header — gradient cover + monogram + pull-quote            */
/* ------------------------------------------------------------------ */

function StoryHeader({
  name,
  sponsorship,
  info,
  lang,
}: {
  name: string;
  sponsorship: Sponsorship;
  info: PublicOrphanDetail | undefined;
  lang: string;
}) {
  const { t } = useTranslation();

  const since = humanDuration(sponsorship.start_date);
  const sinceText = since ? formatDuration(since, t) : null;
  const country = info?.country ? countryName(info.country, lang) : null;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
      aria-label={t("donorTimeline.storyTitle")}
    >
      {/* Soft brand cover band. Faceless by design — warmth comes from the
          gradient + monogram, never a photo. */}
      <div
        aria-hidden="true"
        className="h-24 bg-gradient-to-l from-trust-500 via-trust-400 to-sky-300 dark:from-trust-700 dark:via-trust-600 dark:to-trust-500 sm:h-28"
      />

      <div className="px-6 pb-6">
        <div className="-mt-12 flex flex-col items-center gap-3 sm:-mt-14 sm:flex-row sm:items-end sm:gap-5">
          <MonogramAvatar name={name} />
          <div className="min-w-0 flex-1 text-center sm:pb-1 sm:text-start">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
              {name}
            </h1>
            {sponsorship.orphan_code && (
              <p className="font-mono text-xs text-gray-500">
                {sponsorship.orphan_code}
              </p>
            )}
          </div>
          {info?.is_hafiz && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-sm font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-100">
              <StarIcon />
              {t("donor.orphanDetail.hafiz")}
            </span>
          )}
        </div>

        {/* Key facts as inline icon chips — not a flat gray table. */}
        {info && (
          <ul className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <FactChip icon={<CakeIcon />}>
              {t("donor.orphanDetail.ageValue", { age: info.age_years })}
            </FactChip>
            <FactChip icon={<PersonIcon />}>
              {info.gender === "M"
                ? t("donor.orphanDetail.male")
                : t("donor.orphanDetail.female")}
            </FactChip>
            {country && <FactChip icon={<GlobeIcon />}>{country}</FactChip>}
            {info.education_stage && (
              <FactChip icon={<BookIcon />}>
                {t(`orphans.profile.educationStageOptions.${info.education_stage}`)}
              </FactChip>
            )}
          </ul>
        )}

        {/* Relationship line — gentle warmth near the hero. */}
        {sinceText && (
          <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-trust-700 dark:text-tranquil-200">
            <HeartIcon />
            {t("donorTimeline.sponsoringSince", { name, duration: sinceText })}
          </p>
        )}

        {/* Aspiration — the emotional anchor, given real presence. */}
        {info?.aspiration && (
          <figure className="mt-4 rounded-xl border-s-4 border-trust-300 bg-tranquil-100 px-4 py-3 dark:border-trust-500/40 dark:bg-trust-500/10">
            <figcaption className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-trust-500">
              <QuoteIcon />
              {t("donorTimeline.aspirationLead")}
            </figcaption>
            <blockquote className="mt-1 text-lg font-semibold leading-snug text-trust-800 dark:text-tranquil-100">
              {info.aspiration}
            </blockquote>
          </figure>
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
      </div>
    </section>
  );
}

/** Faceless avatar: the child's monogram inside a soft brand gradient
 * circle that overlaps the cover band. Works for Arabic and Latin names. */
function MonogramAvatar({ name }: { name: string }) {
  const letter = name.trim().charAt(0) || "•";
  return (
    <span
      aria-hidden="true"
      className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-trust-300 to-trust-600 text-4xl font-bold text-white shadow-md dark:border-gray-800"
    >
      {letter}
    </span>
  );
}

function FactChip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-tranquil-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">
      <span className="text-trust-500 dark:text-tranquil-300">{icon}</span>
      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* B) Journey strip — meaningful, colored stat tiles                   */
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

  const ratingTone =
    (latestRatingCode && EDU_RATING_TONE[latestRatingCode]) || "trust";

  return (
    <section className="card" aria-label={t("donorTimeline.journeyTitle", { name })}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorTimeline.journeyTitle", { name })}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {latestJuz !== null && (
          <StatTile
            tone="success"
            icon={<QuranIcon />}
            label={t("donorTimeline.quranProgressLabel")}
          >
            <div className="flex items-center gap-3">
              <ProgressRing
                value={latestJuz}
                max={JUZ_TOTAL}
                tone="success"
                ariaLabel={t("donorTimeline.juzOfTotal", { n: latestJuz })}
              />
              <div className="min-w-0">
                <p className="font-bold text-gray-900 dark:text-gray-100">
                  {t("donorTimeline.juzOfTotal", { n: latestJuz })}
                </p>
                {juzGained !== null && juzGained > 0 && (
                  <p className="mt-0.5 text-xs font-medium text-success-700 dark:text-success-300">
                    {t("donorTimeline.juzGained", { n: juzGained })}
                  </p>
                )}
              </div>
            </div>
          </StatTile>
        )}

        {latestRatingCode && (
          <StatTile
            tone={ratingTone}
            icon={<StarIcon />}
            label={t("donorTimeline.latestRating")}
          >
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t(`orphanageManager.report.eduRatingOptions.${latestRatingCode}`)}
            </p>
          </StatTile>
        )}

        {reports.length > 0 && (
          <StatTile
            tone="trust"
            icon={<InboxIcon />}
            label={t("donorTimeline.updatesReceived")}
          >
            <p className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {reports.length}
            </p>
          </StatTile>
        )}

        {sinceText && (
          <StatTile
            tone="sky"
            icon={<HeartIcon />}
            label={t("donorTimeline.durationTileLabel")}
          >
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {sinceText}
            </p>
          </StatTile>
        )}
      </div>
    </section>
  );
}

function StatTile({
  tone,
  icon,
  label,
  children,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${TONE_TILE[tone]}`}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_CHIP[tone]}`}
        >
          {icon}
        </span>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {label}
        </span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Inline-SVG progress ring (no charting lib). Decorative — the value is
 * always also shown as text alongside, so color/arc is never the only
 * signal; `ariaLabel` voices it for screen readers. */
function ProgressRing({
  value,
  max,
  tone,
  ariaLabel,
}: {
  value: number;
  max: number;
  tone: Tone;
  ariaLabel: string;
}) {
  const R = 18;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const dash = C * pct;
  return (
    <svg
      viewBox="0 0 48 48"
      className="h-12 w-12 shrink-0"
      role="img"
      aria-label={ariaLabel}
    >
      <circle
        cx="24"
        cy="24"
        r={R}
        fill="none"
        strokeWidth="5"
        className="stroke-gray-200 dark:stroke-gray-700"
      />
      <circle
        cx="24"
        cy="24"
        r={R}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${C}`}
        transform="rotate(-90 24 24)"
        className={TONE_STROKE[tone]}
      />
    </svg>
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
        <ol className="space-y-5 border-s-2 border-sky-200 ps-6 dark:border-gray-700">
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
  const milestone = report.is_milestone;

  return (
    <li className="relative">
      {/* Spine node — milestone nodes are larger, star-marked, success-ringed
          so the eye lands on real progress. */}
      {milestone ? (
        <span
          aria-hidden="true"
          className="absolute -start-[2.25rem] top-1 flex h-6 w-6 items-center justify-center rounded-full bg-success-500 text-white ring-4 ring-success-100 dark:ring-success-500/25"
        >
          <StarIcon />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="absolute -start-[1.875rem] top-2 h-3 w-3 rounded-full bg-trust-400 ring-4 ring-white dark:ring-gray-800"
        />
      )}

      <article
        className={
          milestone
            ? "card border-2 border-success-300 bg-success-50/60 dark:border-success-500/40 dark:bg-success-500/5"
            : "card"
        }
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(report.period_start, lang)} –{" "}
            {formatDate(report.period_end, lang)}
          </span>
          <span className="rounded-full bg-tranquil-200 px-2 py-0.5 text-xs font-medium text-trust-700 dark:bg-gray-700 dark:text-tranquil-200">
            {t(`orphanageManager.report.reportTypeOptions.${report.report_type}`, {
              defaultValue: report.report_type,
            })}
          </span>
          {provenanceDate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-100">
              <CheckIcon />
              {t("donorTimeline.reviewedBadge")}
            </span>
          )}
          {milestone && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-semibold text-success-700 dark:bg-success-500/20 dark:text-success-100">
              <StarIcon />
              {report.milestone_label || t("donorTimeline.milestoneBadge")}
            </span>
          )}
        </header>

        {/* Section chips carry the visual story (see SectionHighlights). */}
        <SectionHighlights report={report} />

        {/* donor_message — the human touch, featured as a warm quote. */}
        {report.donor_message && (
          <blockquote className="mt-4 rounded-lg border-s-4 border-trust-300 bg-tranquil-100 px-3 py-2 dark:border-trust-500/40 dark:bg-trust-500/10">
            <p className="flex items-center gap-1 text-xs font-medium text-trust-600 dark:text-tranquil-200">
              <QuoteIcon />
              {t("donorTimeline.supervisorNoteTitle")}
            </p>
            <p className="mt-1 whitespace-pre-line text-sm italic text-trust-800 dark:text-tranquil-100">
              “{report.donor_message}”
            </p>
          </blockquote>
        )}

        {/* Supervisor summary — kept, but secondary: it repeats month to
            month, so it must not dominate the colored chips above. */}
        {report.summary && (
          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {report.summary}
          </p>
        )}

        {provenanceDate && (
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
            {formatDate(provenanceDate, lang)}
          </p>
        )}
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
        <div className="flex flex-wrap items-center gap-1.5">
          {edu.overall_rating && (
            <Chip tone={EDU_RATING_TONE[edu.overall_rating] ?? "trust"}>
              {t(`orphanageManager.report.eduRatingOptions.${edu.overall_rating}`)}
            </Chip>
          )}
          {edu.attendance_percent != null && (
            <AttendanceMeter percent={edu.attendance_percent} />
          )}
          {edu.stage && (
            <Chip tone="gray">
              {t("donorTimeline.stageLabel")}: {edu.stage}
            </Chip>
          )}
          {edu.school_name && (
            <Chip tone="gray">
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
        <div className="flex flex-wrap items-center gap-1.5">
          {quran.juz_memorized != null && (
            <JuzChip value={quran.juz_memorized} />
          )}
          {quran.evaluation && (
            <Chip tone={QURAN_EVAL_TONE[quran.evaluation] ?? "trust"}>
              {t(
                `orphanageManager.report.quranEvaluationOptions.${quran.evaluation}`,
              )}
            </Chip>
          )}
          {quran.current_juz != null && (
            <Chip tone="gray">
              {t("donorTimeline.currentJuz", { n: quran.current_juz })}
            </Chip>
          )}
        </div>
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
          <Chip tone={HEALTH_TONE[health.general] ?? "gray"}>
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
            <Chip tone={MOOD_TONE[psych.mood] ?? "gray"}>
              {t(`orphanageManager.report.moodOptions.${psych.mood}`)}
            </Chip>
          )}
          {psych.social && (
            <Chip tone={SOCIAL_TONE[psych.social] ?? "gray"}>
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
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  tone = "trust",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

/** Attendance as a chip with a tiny inline meter. Color is tinted by the
 * value but the percentage text always stands alongside the bar. */
function AttendanceMeter({ percent }: { percent: number }) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const tone: Tone = pct >= 90 ? "success" : pct >= 75 ? "sky" : "warning";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CHIP[tone]}`}
    >
      {t("donorTimeline.attendance", { percent })}
      <span
        aria-hidden="true"
        className="h-1.5 w-10 overflow-hidden rounded-full bg-white/60 dark:bg-black/20"
      >
        <span
          className={`block h-full rounded-full ${
            tone === "success"
              ? "bg-success-500"
              : tone === "sky"
                ? "bg-sky-400"
                : "bg-warning-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

/** Qur'an juz' as a success-tinted chip with a mini progress indicator
 * toward the full 30 juz'. */
function JuzChip({ value }: { value: number }) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round((value / JUZ_TOTAL) * 100)));
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-100">
      {t("donorTimeline.juzMemorized", { n: value })}
      <span
        aria-hidden="true"
        className="h-1.5 w-10 overflow-hidden rounded-full bg-white/60 dark:bg-black/20"
      >
        <span
          className="block h-full rounded-full bg-success-500"
          style={{ width: `${pct}%` }}
        />
      </span>
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
/* F) Money trail (financial transparency)                             */
/* ------------------------------------------------------------------ */

function MoneyTrail({
  sponsorship,
  payments,
  loading,
  lang,
}: {
  sponsorship: Sponsorship;
  payments: PaymentDonorRead[];
  loading: boolean;
  lang: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="card space-y-4" aria-label={t("donor.orphanDetail.paymentsTitle")}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donor.orphanDetail.paymentsTitle")}
      </h2>

      <div className="panel">
        <dt className="text-xs text-gray-500">
          {t("donor.orphanDetail.totalContributed")}
        </dt>
        <dd className="mt-1 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {sponsorship.total_paid} {sponsorship.currency}
        </dd>
      </div>

      {loading && <Skeleton className="h-32 w-full" />}

      {!loading && payments.length === 0 && (
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          {t("donor.orphanDetail.paymentsEmpty")}
        </p>
      )}

      {!loading && payments.length > 0 && (
        <ol className="space-y-3">
          {payments.map((p) => (
            <PaymentRow key={p.id} payment={p} lang={lang} />
          ))}
        </ol>
      )}
    </section>
  );
}

function PaymentRow({ payment, lang }: { payment: PaymentDonorRead; lang: string }) {
  const { t } = useTranslation();
  const displayDate = payment.completed_at ?? payment.initiated_at;
  const statusKey =
    payment.status === "completed"
      ? "donor.orphanDetail.paymentCompleted"
      : payment.status === "failed"
        ? "donor.orphanDetail.paymentFailed"
        : "donor.orphanDetail.paymentPending";
  const statusClass =
    payment.status === "completed"
      ? "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-100"
      : payment.status === "failed"
        ? "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100"
        : "bg-tranquil-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300";

  return (
    <li className="panel flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <span className="tabular-nums font-semibold text-gray-900 dark:text-gray-100">
          {payment.amount} {payment.currency}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(displayDate, lang)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
          {t(statusKey)}
        </span>
        {payment.receipt_url && (
          <a
            href={payment.receipt_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-trust-600 underline hover:text-trust-700 dark:text-tranquil-300 dark:hover:text-tranquil-100"
          >
            {t("donor.orphanDetail.receiptLink")}
          </a>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces + icons                                         */
/* ------------------------------------------------------------------ */

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

function CakeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" strokeLinecap="round" />
      <path d="M3 12h18M12 8V5m-4 3V6m8 2V6" strokeLinecap="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2V5zM20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2V5z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-10-9.3C.6 8.9 2 5.5 5.2 5.1c2-.3 3.6.8 4.8 2.3 1.2-1.5 2.8-2.6 4.8-2.3 3.2.4 4.6 3.8 3.2 6.6C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M7 7H5a3 3 0 0 0-3 3v7h7v-7H5a2 2 0 0 1 2-2V7zm12 0h-2a3 3 0 0 0-3 3v7h7v-7h-4a2 2 0 0 1 2-2V7z" />
    </svg>
  );
}

function QuranIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        d="M12 6c-2-1.5-4.5-1.5-7-0.8v12c2.5-0.7 5-0.7 7 0.8 2-1.5 4.5-1.5 7-0.8v-12c-2.5-0.7-5-0.7-7 0.8z"
        strokeLinejoin="round"
      />
      <path d="M12 6v13" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        d="M4 13l2-7h12l2 7M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M4 13h5l1 2h4l1-2h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
