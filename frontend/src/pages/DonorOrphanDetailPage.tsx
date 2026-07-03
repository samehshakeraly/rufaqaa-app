import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { countryName } from "@/lib/countries";
import { formatDate, formatDuration, humanDuration } from "@/lib/format";
import type { MessageRead } from "@/lib/messages";
import {
  listSponsorshipMessages,
  sendSponsorshipMessage,
  SPONSORSHIP_MESSAGE_MAX_LEN,
} from "@/lib/messages";
import type { Page } from "@/lib/orphans";
import type { PaymentDonorRead } from "@/lib/payments";
import { listMyPayments } from "@/lib/payments";
import type { PublicOrphan, SponsoredOrphanProfile } from "@/lib/public";
import { getPublicStats, getSponsoredOrphanProfile, listPublicOrphans } from "@/lib/public";
import type { ReportDonorRead } from "@/lib/reports";
import { listMyReports } from "@/lib/reports";
import type { Sponsorship } from "@/lib/sponsorships";
import { listMySponsorships } from "@/lib/sponsorships";
import { toast } from "@/store/toasts";

const JUZ_TOTAL = 30;

const TIMELINE_ANCHOR = "reports-timeline";

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
  success: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-100",
  trust: "bg-trust-100 text-trust-700 dark:bg-trust-500/20 dark:text-tranquil-100",
  sky: "bg-sky-100 text-trust-700 dark:bg-sky-400/20 dark:text-tranquil-100",
  warning: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100",
  gray: "bg-tranquil-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
};

/** Larger tinted stat-tile surface (border + background) for each tone. */
const TONE_TILE: Record<Tone, string> = {
  success: "border-success-100 bg-success-50 dark:border-success-500/30 dark:bg-success-500/10",
  trust: "border-trust-200 bg-tranquil-100 dark:border-trust-500/30 dark:bg-trust-500/10",
  sky: "border-sky-200 bg-sky-100 dark:border-sky-400/30 dark:bg-sky-400/10",
  warning: "border-warning-100 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10",
  gray: "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60",
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

/** Localize an education-stage enum code through the shared map, falling
 * back to the raw code so an unknown value never renders blank. */
function eduStageLabel(
  code: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (!code) return null;
  return t(`orphans.profile.educationStageOptions.${code}`, {
    defaultValue: code,
  });
}

/** Localize a social-interaction enum code; falls back to the raw code. */
function socialLabel(
  code: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`orphanageManager.report.socialOptions.${code}`, {
    defaultValue: code,
  });
}

/** D-07 — the donor's "child journey" detail page.
 *
 * Route: /donor/orphans/:id  (:id is the orphan_id).
 *
 * The sponsorship is located inside the donor's own /me/sponsorships
 * list, so a donor can only ever reach a child they actually sponsor —
 * never another donor's orphan. The page is read-only: it renders the
 * composed, donor-safe `SponsoredOrphanProfile` (every element block is
 * optional — shown only when the backend includes it) as a warm, human
 * story, alongside the donor's own payments and the reports timeline.
 *
 * The "أرشيف رسائلك إليها" archive (the donor's own moderated messages to
 * this child) is fetched independently — it is the donor's OWN content, not
 * part of the visibility-gated SponsoredOrphanProfile.
 *
 * Out of scope here: child photos (privacy — a monogram avatar stands in). */
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

  // Composed donor-safe profile, scoped by the donor's own sponsorship
  // (keyed by orphan id), so it resolves even for a sponsored child that
  // is no longer publicly browseable. If it fails, the timeline / payments
  // still render and the name falls back to the sponsorship record.
  const profileQ = useQuery({
    queryKey: ["donor", "me", "orphanProfile", id],
    queryFn: () => getSponsoredOrphanProfile(id!),
    enabled: !!id,
    retry: false,
  });

  // Newest-first for the timeline.
  const reports = (reportsQ.data?.items ?? [])
    .filter((r) => r.orphan_id === id)
    .sort((a, b) => new Date(b.period_start).getTime() - new Date(a.period_start).getTime());

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

  const profile = profileQ.data;
  const name = sponsorship.orphan_name ?? profile?.first_name ?? "—";
  const isRtl = lang === "ar";

  return (
    <div className="space-y-6">
      <Link to="/donor/orphans" className="text-sm text-trust-600 underline">
        ← {t("donor.orphanDetail.back")}
      </Link>

      <IdentityHeader name={name} sponsorship={sponsorship} profile={profile} lang={lang} />

      {/* Composed profile blocks — each rendered ONLY when present, ordered
          for emotional impact (dream first, her world last). */}
      {profile?.dream && <DreamSection name={name} dream={profile.dream} />}

      {profile?.quran_growth && <QuranGrowthSection growth={profile.quran_growth} lang={lang} />}

      {profile?.multidim_growth && (
        <MultidimGrowthSection growth={profile.multidim_growth} isRtl={isRtl} />
      )}

      {/* The dream roadmap sits right after the growth story: the real
          education stages leading to the child's stated aspiration. */}
      {profile?.aspiration && (
        <DreamRoadmapSection
          name={name}
          aspiration={profile.aspiration}
          educationStage={profile.education_stage ?? null}
        />
      )}

      {profile?.milestones && profile.milestones.items.length > 0 && (
        <MilestonesSection milestones={profile.milestones} lang={lang} />
      )}

      {profile?.recent_updates && profile.recent_updates.items.length > 0 && (
        <RecentUpdatesSection updates={profile.recent_updates} lang={lang} />
      )}

      {profile?.supervisor_word && (
        <SupervisorWordSection word={profile.supervisor_word} lang={lang} />
      )}

      {profile?.her_world && <HerWorldSection name={name} world={profile.her_world} />}

      {/* Health — the FIRST health data on any donor surface: a reassuring,
          non-clinical summary (coded status + last checkup + vaccinations),
          stripped server-side when hidden or empty. Present ⇒ safe to show. */}
      {profile?.health && <HealthSection name={name} health={profile.health} lang={lang} />}

      {/* "بيت سارة" — a PII-free glimpse of the child's home: governorate-level
          region + coded housing status ONLY (never a city, street, address or
          income), stripped server-side when hidden or empty. Present ⇒ safe. */}
      {profile?.home && <HomeSection name={name} home={profile.home} />}

      {/* "من يرعاها" — who cares for the child: coded relation + occupation
          ONLY (never a name or contact detail), stripped server-side when
          hidden or absent. Present ⇒ safe to show. */}
      {profile?.guardian && <GuardianSection name={name} guardian={profile.guardian} />}

      {/* "In her words" — curated phrases in the child's own voice. Server
          strips the block entirely when hidden or empty, so a present array is
          always non-empty. */}
      {profile?.in_her_words && profile.in_her_words.length > 0 && (
        <InHerWordsSection name={name} phrases={profile.in_her_words} lang={lang} />
      )}

      {/* "ذكرى الأب" — a dignified remembrance of the deceased father. Double-
          gated server-side (guardian consent AND supervisor visibility); the
          block is present here only when both gates are satisfied. */}
      {profile?.father_memory && <FatherMemorySection memory={profile.father_memory} />}

      {/* The "memory box" — donor-cleared artefacts, placed right before the
          factual timeline/payments so warmth precedes paperwork. Renders
          NOTHING when media is null or every group is empty. */}
      {profile?.media && <MemoryBoxSection name={name} media={profile.media} lang={lang} />}

      {/* Existing, profile-independent sections. */}
      <Timeline name={name} reports={reports} loading={reportsQ.isLoading} lang={lang} />

      {/* "أرشيف رسائلك إليها" — the donor's own moderated messages to this
          child. Fetched independently (NOT a ProfileElement, NOT gated by
          profile_visibility): this is the donor's OWN content. */}
      <MessageArchiveSection orphanId={id} lang={lang} />

      <SponsorshipCard sponsorship={sponsorship} lang={lang} />

      <MoneyTrail
        sponsorship={sponsorship}
        payments={paymentsQ.data?.items ?? []}
        loading={paymentsQ.isLoading}
        lang={lang}
      />

      {/* "Expand your impact" closing zone — tree → collective → waiting.
          Each section is independently conditional and self-guarding: a
          missing block or a failed/empty public query renders nothing and
          never breaks the page. */}
      {profile?.since_you_began && <ImpactTreeSection block={profile.since_you_began} />}

      <CollectiveStatsSection />

      <ChildrenWaitingSection excludeCode={sponsorship.orphan_code ?? null} lang={lang} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A) Identity header — cover + monogram + facts + "since you began"   */
/* ------------------------------------------------------------------ */

function IdentityHeader({
  name,
  sponsorship,
  profile,
  lang,
}: {
  name: string;
  sponsorship: Sponsorship;
  profile: SponsoredOrphanProfile | undefined;
  lang: string;
}) {
  const { t } = useTranslation();

  const since = humanDuration(sponsorship.start_date);
  const sinceText = since ? formatDuration(since, t) : null;
  const country = profile?.country ? countryName(profile.country, lang) : null;
  const stage = eduStageLabel(profile?.education_stage, t);
  const isHafiz = !!profile?.is_hafiz;

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
          <MonogramAvatar name={name} isHafiz={isHafiz} />
          <div className="min-w-0 flex-1 text-center sm:pb-1 sm:text-start">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
              {name}
            </h1>
            {sponsorship.orphan_code && (
              <p className="font-mono text-xs text-gray-500">{sponsorship.orphan_code}</p>
            )}
          </div>
          {isHafiz && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-sm font-semibold text-success-700 dark:bg-success-500/15 dark:text-success-100">
              <StarIcon />
              {t("donor.orphanDetail.hafiz")}
            </span>
          )}
        </div>

        {/* Key facts as inline icon chips — not a flat gray table. */}
        {profile && (
          <ul className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <FactChip icon={<CakeIcon />}>
              {t("donor.orphanDetail.ageValue", { age: profile.age_years })}
            </FactChip>
            <FactChip icon={<PersonIcon />}>
              {profile.gender === "M"
                ? t("donor.orphanDetail.male")
                : t("donor.orphanDetail.female")}
            </FactChip>
            {country && <FactChip icon={<GlobeIcon />}>{country}</FactChip>}
            {stage && <FactChip icon={<BookIcon />}>{stage}</FactChip>}
            {profile.partner_organization_name && (
              <FactChip icon={<HomeIcon />}>{profile.partner_organization_name}</FactChip>
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

        {/* "Since you began" — the donor's own delta strip. */}
        {profile?.since_you_began && (
          <SinceYouBeganStrip block={profile.since_you_began} lang={lang} />
        )}
      </div>
    </section>
  );
}

/** Faceless avatar: the child's monogram inside a soft brand gradient
 * circle that overlaps the cover band. Works for Arabic and Latin names.
 * A hafiz earns a success-tinted honor ring + star badge. */
function MonogramAvatar({ name, isHafiz }: { name: string; isHafiz: boolean }) {
  const { t } = useTranslation();
  const letter = name.trim().charAt(0) || "•";
  return (
    <span className="relative shrink-0">
      <span
        aria-hidden="true"
        className={`flex h-24 w-24 items-center justify-center rounded-full border-4 bg-gradient-to-br from-trust-300 to-trust-600 text-4xl font-bold text-white shadow-md dark:border-gray-800 ${
          isHafiz
            ? "border-success-300 ring-4 ring-success-200 dark:ring-success-500/30"
            : "border-white"
        }`}
      >
        {letter}
      </span>
      {isHafiz && (
        <span
          className="absolute -bottom-1 -end-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-success-500 text-white shadow dark:border-gray-800"
          title={t("donor.orphanDetail.hafiz")}
          aria-label={t("donor.orphanDetail.hafiz")}
        >
          <StarIcon />
        </span>
      )}
    </span>
  );
}

function FactChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-tranquil-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">
      <span className="text-trust-500 dark:text-tranquil-300">{icon}</span>
      {children}
    </li>
  );
}

/** "منذ أن بدأت" — what changed since this donor's sponsorship began. A
 * compact strip of deltas: juz gained, milestones, reports, bond duration. */
function SinceYouBeganStrip({
  block,
  lang,
}: {
  block: NonNullable<SponsoredOrphanProfile["since_you_began"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  const dur = humanDuration(block.start_date);
  const durText = dur ? formatDuration(dur, t) : null;

  const items: { key: string; value: string }[] = [];
  if (block.juz_gained > 0) {
    items.push({
      key: "juz",
      value: t("donorProfile.sinceJuzGained", { n: block.juz_gained }),
    });
  }
  if (block.milestones_count > 0) {
    items.push({
      key: "milestones",
      value: t("donorProfile.sinceMilestones", { n: block.milestones_count }),
    });
  }
  if (block.reports_count > 0) {
    items.push({
      key: "reports",
      value: t("donorProfile.sinceReports", { n: block.reports_count }),
    });
  }
  if (durText) {
    items.push({ key: "bond", value: durText });
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-trust-200 bg-tranquil-100 px-4 py-3 dark:border-trust-500/30 dark:bg-trust-500/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-trust-500">
        <HeartIcon />
        {t("donorProfile.sinceTitle")}
        <span className="font-normal normal-case text-trust-400">
          · {formatDate(block.start_date, lang)}
        </span>
      </p>
      <ul className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-trust-300">
                ·
              </span>
            )}
            <span className="text-sm font-semibold text-trust-800 dark:text-tranquil-100">
              {it.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* B) Dream — the emotional anchor                                     */
/* ------------------------------------------------------------------ */

function DreamSection({
  name,
  dream,
}: {
  name: string;
  dream: NonNullable<SponsoredOrphanProfile["dream"]>;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="overflow-hidden rounded-2xl border-s-4 border-trust-400 bg-gradient-to-l from-tranquil-100 to-white p-6 shadow-sm dark:border-trust-500/50 dark:from-trust-500/10 dark:to-gray-800"
      aria-label={t("donorProfile.dreamTitle", { name })}
    >
      <figure>
        <figcaption className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-trust-500">
          <QuoteIcon />
          {t("donorProfile.dreamLead")}
        </figcaption>
        <blockquote className="mt-2 text-2xl font-bold leading-snug text-trust-800 dark:text-tranquil-100 sm:text-3xl">
          {dream.aspiration}
        </blockquote>
      </figure>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* B2) Dream roadmap — the real stages leading to the aspiration       */
/* ------------------------------------------------------------------ */

// The actual education stages, in order, that form the path toward the
// dream. We deliberately use ONLY the real stage codes (never invented
// ones) so the localized labels reuse the shared education-stage map.
const ROADMAP_STAGES = ["primary", "preparatory", "secondary"] as const;

type RoadmapState = "done" | "current" | "upcoming" | "dream";

/** A horizontal, stepped path from the child's current education stage to
 * their stated aspiration. The stage matching `educationStage` is the
 * "you are here" node; earlier stages read as done, later ones as upcoming,
 * and the final node is the dream itself. With a null stage we still draw
 * the full path + dream node, just without a current marker. */
function DreamRoadmapSection({
  name,
  aspiration,
  educationStage,
}: {
  name: string;
  aspiration: string;
  educationStage: string | null;
}) {
  const { t } = useTranslation();
  const currentIdx = educationStage
    ? (ROADMAP_STAGES as readonly string[]).indexOf(educationStage)
    : -1;
  const lastIdx = ROADMAP_STAGES.length - 1;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.roadmapAria", { name })}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorProfile.roadmapTitle")}
      </h2>
      <ol className="flex items-start gap-1 overflow-x-auto pb-1">
        {ROADMAP_STAGES.map((stage, i) => {
          const state: RoadmapState =
            currentIdx >= 0 && i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
          return (
            <RoadmapStep
              key={stage}
              label={eduStageLabel(stage, t) ?? stage}
              state={state}
              first={i === 0}
              leftFilled={currentIdx >= 0 && i <= currentIdx}
            />
          );
        })}
        <RoadmapStep
          label={aspiration}
          caption={t("donorProfile.roadmapDreamNode")}
          state="dream"
          last
          leftFilled={currentIdx >= 0 && currentIdx >= lastIdx}
        />
      </ol>
    </section>
  );
}

function RoadmapStep({
  label,
  caption,
  state,
  first,
  last,
  leftFilled,
}: {
  label: string;
  caption?: string;
  state: RoadmapState;
  first?: boolean;
  last?: boolean;
  leftFilled: boolean;
}) {
  const { t } = useTranslation();
  const isCurrent = state === "current";
  const isDream = state === "dream";

  const nodeClass =
    state === "done"
      ? "bg-success-500 text-white"
      : state === "current"
        ? "bg-trust-500 text-white ring-4 ring-trust-200 dark:ring-trust-500/30"
        : state === "dream"
          ? "bg-gradient-to-br from-trust-400 to-trust-600 text-white ring-2 ring-trust-200 dark:ring-trust-500/30"
          : "border-2 border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-800";

  const labelClass =
    state === "done"
      ? "text-success-700 dark:text-success-300"
      : state === "current"
        ? "font-semibold text-trust-700 dark:text-tranquil-200"
        : state === "dream"
          ? "font-semibold text-trust-800 dark:text-tranquil-100"
          : "text-gray-500 dark:text-gray-400";

  const stateLabel =
    state === "done"
      ? t("donorProfile.roadmapStepDone")
      : state === "current"
        ? t("donorProfile.roadmapStepCurrent")
        : state === "dream"
          ? t("donorProfile.roadmapDreamNode")
          : t("donorProfile.roadmapStepUpcoming");

  const connectorBase = "h-0.5 flex-1 rounded-full";
  const filledConnector = "bg-success-400 dark:bg-success-500/50";
  const trackConnector = "bg-gray-200 dark:bg-gray-700";

  return (
    <li
      className="relative flex min-w-0 flex-1 flex-col items-center text-center"
      aria-current={isCurrent ? "step" : undefined}
    >
      <div className="flex w-full items-center" aria-hidden="true">
        <span
          className={`${connectorBase} ${first ? "opacity-0" : leftFilled ? filledConnector : trackConnector}`}
        />
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${nodeClass}`}
        >
          {state === "done" ? (
            <CheckIcon />
          ) : isDream ? (
            <StarIcon />
          ) : isCurrent ? (
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
          ) : null}
        </span>
        <span className={`${connectorBase} ${last ? "opacity-0" : trackConnector}`} />
      </div>
      <span className={`mt-2 line-clamp-2 px-1 text-xs ${labelClass}`}>{label}</span>
      {isCurrent && (
        <span className="mt-1 inline-flex items-center rounded-full bg-trust-100 px-2 py-0.5 text-[10px] font-semibold text-trust-700 dark:bg-trust-500/20 dark:text-tranquil-200">
          {t("donorProfile.roadmapYouAreHere")}
        </span>
      )}
      {isDream && caption && (
        <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-trust-400">
          {caption}
        </span>
      )}
      <span className="sr-only">{stateLabel}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* C) Qur'an growth — juz' over time (inline area chart)               */
/* ------------------------------------------------------------------ */

function QuranGrowthSection({
  growth,
  lang,
}: {
  growth: NonNullable<SponsoredOrphanProfile["quran_growth"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  const series = growth.series;
  const first = series[0];
  const latest = series[series.length - 1];
  if (!first || !latest) return null;
  const single = series.length === 1;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.quranGrowthTitle")}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_CHIP.success}`}
        >
          <QuranIcon />
        </span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.quranGrowthTitle")}
        </h2>
      </div>

      <QuranGrowthChart series={series} lang={lang} />

      <p className="text-sm text-gray-600 dark:text-gray-300">
        {single
          ? t("donorProfile.quranGrowthSingle", { n: latest.juz_memorized })
          : t("donorProfile.quranGrowthCaption", {
              first: first.juz_memorized,
              latest: latest.juz_memorized,
            })}
      </p>
    </section>
  );
}

/** Inline-SVG area chart of juz' memorized over time, scaled to the full
 * 30 juz' so progress reads against the whole Qur'an. A single point draws
 * one dignified dot — never a fabricated slope. Value is also voiced via
 * aria-label and stated in the caption, so color is never the only signal. */
function QuranGrowthChart({
  series,
  lang,
}: {
  series: NonNullable<SponsoredOrphanProfile["quran_growth"]>["series"];
  lang: string;
}) {
  const { t } = useTranslation();
  const W = 320;
  const H = 96;
  const PAD = 8;
  const n = series.length;
  const span = JUZ_TOTAL;

  const first = series[0];
  const latest = series[series.length - 1];
  if (!first || !latest) return null;

  const points = series.map((p, i) => {
    const x = n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1);
    const v = Math.max(0, Math.min(span, p.juz_memorized));
    const y = H - PAD - (v / span) * (H - 2 * PAD);
    return [x, y] as const;
  });

  const ariaLabel = t("donorProfile.quranGrowthAria", {
    latest: latest.juz_memorized,
    total: JUZ_TOTAL,
  });

  return (
    <figure className="rounded-xl border border-success-100 bg-success-50/50 p-3 dark:border-success-500/30 dark:bg-success-500/10">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        {n >= 2 && (
          <>
            <polygon
              points={`${PAD},${H - PAD} ${points
                .map(([x, y]) => `${x},${y}`)
                .join(" ")} ${W - PAD},${H - PAD}`}
              className="fill-success-400/20 dark:fill-success-400/15"
            />
            <polyline
              points={points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              className="stroke-success-500"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === points.length - 1 ? 4 : 2.5}
            className="fill-success-600"
          />
        ))}
      </svg>
      <figcaption className="mt-1 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
        <span>{formatDate(first.period, lang)}</span>
        <span className="font-semibold tabular-nums text-success-700 dark:text-success-300">
          {t("donorTimeline.juzOfTotal", { n: latest.juz_memorized })}
        </span>
        {n >= 2 && <span>{formatDate(latest.period, lang)}</span>}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* D) Multidimensional growth — "before → now" mini-cards              */
/* ------------------------------------------------------------------ */

function MultidimGrowthSection({
  growth,
  isRtl,
}: {
  growth: NonNullable<SponsoredOrphanProfile["multidim_growth"]>;
  isRtl: boolean;
}) {
  const { t } = useTranslation();

  const cards: React.ReactNode[] = [];

  if (growth.education_stage) {
    cards.push(
      <BeforeNowCard
        key="stage"
        tone="trust"
        icon={<BookIcon />}
        label={t("donorProfile.multidimEducationStage")}
        first={eduStageLabel(growth.education_stage.first, t) ?? "—"}
        latest={eduStageLabel(growth.education_stage.latest, t) ?? "—"}
        isRtl={isRtl}
      />,
    );
  }
  if (growth.attendance_percent) {
    cards.push(
      <BeforeNowCard
        key="attendance"
        tone="sky"
        icon={<CalendarIcon />}
        label={t("donorProfile.multidimAttendance")}
        first={t("donorProfile.percentValue", {
          n: Math.round(growth.attendance_percent.first),
        })}
        latest={t("donorProfile.percentValue", {
          n: Math.round(growth.attendance_percent.latest),
        })}
        isRtl={isRtl}
      />,
    );
  }
  if (growth.social) {
    cards.push(
      <BeforeNowCard
        key="social"
        tone="success"
        icon={<HeartIcon />}
        label={t("donorProfile.multidimSocial")}
        first={socialLabel(growth.social.first, t)}
        latest={socialLabel(growth.social.latest, t)}
        isRtl={isRtl}
      />,
    );
  }

  if (cards.length === 0) return null;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.multidimTitle")}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorProfile.multidimTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards}</div>
    </section>
  );
}

function BeforeNowCard({
  tone,
  icon,
  label,
  first,
  latest,
  isRtl,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  first: string;
  latest: string;
  isRtl: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-xl border p-4 ${TONE_TILE[tone]}`}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_CHIP[tone]}`}
        >
          {icon}
        </span>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm text-gray-500 line-through decoration-1 dark:text-gray-400">
          <span className="sr-only">{t("donorProfile.beforeLabel")}: </span>
          {first}
        </span>
        <ArrowIcon flip={isRtl} />
        <span className="text-base font-bold text-gray-900 dark:text-gray-100">
          <span className="sr-only">{t("donorProfile.nowLabel")}: </span>
          {latest}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* E) Milestones — the celebrated moments                              */
/* ------------------------------------------------------------------ */

function MilestonesSection({
  milestones,
  lang,
}: {
  milestones: NonNullable<SponsoredOrphanProfile["milestones"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="card space-y-4" aria-label={t("donorProfile.milestonesTitle")}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorProfile.milestonesTitle")}
      </h2>
      <ul className="space-y-3">
        {milestones.items.map((m, i) => (
          <li
            key={`${m.label}-${i}`}
            className="flex items-start gap-3 rounded-xl border border-success-100 bg-success-50/60 p-3 dark:border-success-500/30 dark:bg-success-500/10"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-500 text-white"
            >
              <StarIcon />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100">{m.label}</p>
              <p className="mt-0.5 text-xs text-success-700 dark:text-success-300">
                {formatDate(m.period, lang)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* F) Recent updates — newest-first headlines, link to full timeline   */
/* ------------------------------------------------------------------ */

function RecentUpdatesSection({
  updates,
  lang,
}: {
  updates: NonNullable<SponsoredOrphanProfile["recent_updates"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="card space-y-4" aria-label={t("donorProfile.recentUpdatesTitle")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.recentUpdatesTitle")}
        </h2>
        <a
          href={`#${TIMELINE_ANCHOR}`}
          className="shrink-0 text-sm text-trust-600 underline hover:text-trust-700 dark:text-tranquil-300 dark:hover:text-tranquil-100"
        >
          {t("donorProfile.recentUpdatesLink")}
        </a>
      </div>
      <ol className="space-y-3">
        {updates.items.map((u, i) => (
          <li key={`${u.period}-${i}`} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-trust-400"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{u.headline}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {formatDate(u.period, lang)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* G) Supervisor's word — a warm human quote                           */
/* ------------------------------------------------------------------ */

function SupervisorWordSection({
  word,
  lang,
}: {
  word: NonNullable<SponsoredOrphanProfile["supervisor_word"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("donorProfile.supervisorWordTitle")}>
      <figure className="rounded-2xl border-s-4 border-trust-300 bg-tranquil-100 p-6 dark:border-trust-500/40 dark:bg-trust-500/10">
        <figcaption className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-trust-500">
          <QuoteIcon />
          {t("donorProfile.supervisorWordTitle")}
        </figcaption>
        <blockquote className="mt-2 whitespace-pre-line text-lg italic leading-relaxed text-trust-800 dark:text-tranquil-100">
          “{word.text}”
        </blockquote>
        <p className="mt-3 text-sm text-trust-600 dark:text-tranquil-200">
          {word.author_label
            ? `— ${word.author_label} · ${formatDate(word.period, lang)}`
            : formatDate(word.period, lang)}
        </p>
      </figure>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* H) Her world — a warm, non-clinical snapshot of right now           */
/* ------------------------------------------------------------------ */

function HerWorldSection({
  name,
  world,
}: {
  name: string;
  world: NonNullable<SponsoredOrphanProfile["her_world"]>;
}) {
  const { t } = useTranslation();
  const stage = eduStageLabel(world.education_stage, t);

  const chips: React.ReactNode[] = [];
  if (stage) {
    chips.push(
      <WorldChip key="stage" tone="trust">
        {stage}
      </WorldChip>,
    );
  }
  if (world.is_hafiz) {
    chips.push(
      <WorldChip key="hafiz" tone="success">
        <StarIcon />
        {t("donor.orphanDetail.hafiz")}
      </WorldChip>,
    );
  } else if (world.quran_juz_memorized != null) {
    chips.push(
      <WorldChip key="juz" tone="success">
        {t("donor.orphanDetail.quranMemorized", { n: world.quran_juz_memorized })}
      </WorldChip>,
    );
  }
  for (const tag of world.tags) {
    chips.push(
      <WorldChip key={`tag-${tag}`} tone="sky">
        {tag}
      </WorldChip>,
    );
  }

  if (chips.length === 0) return null;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.herWorldTitle", { name })}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorProfile.herWorldTitle", { name })}
      </h2>
      <ul className="flex flex-wrap gap-2">{chips}</ul>
    </section>
  );
}

function WorldChip({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  return (
    <li
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${TONE_CHIP[tone]}`}
    >
      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* H1.4) Health — a reassuring, non-clinical summary                    */
/* ------------------------------------------------------------------ */

// Static (profile-level) health status codes → tones, staying on the
// hopeful/respectful side of the palette like every child-standing signal:
// `warning` is the lowest tone ever used, never alarmist red.
const STATIC_HEALTH_TONE: Record<string, Tone> = {
  good: "success",
  chronic_condition: "sky",
  disability: "sky",
  under_treatment: "warning",
};

/** "الاطمئنان على الصحة" — the gated donor health element. The backend emits
 * this block only when the supervisor left it visible AND at least one value
 * exists, and it carries ONLY the coded status, the last checkup date and the
 * coded vaccinations status — never a diagnosis, coverage or free text — so a
 * present `health` is always safe to show. Every row is independently
 * optional. */
function HealthSection({
  name,
  health,
  lang,
}: {
  name: string;
  health: NonNullable<SponsoredOrphanProfile["health"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  const statusTone: Tone = health.status_label
    ? (STATIC_HEALTH_TONE[health.status_label] ?? "gray")
    : "gray";

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.healthTitle", { name })}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_CHIP.success}`}
        >
          <HeartIcon />
        </span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.healthTitle", { name })}
        </h2>
      </div>

      {health.status_label && (
        <p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${TONE_CHIP[statusTone]}`}
          >
            {t(`donorProfile.healthStatusOptions.${health.status_label}`, {
              defaultValue: health.status_label,
            })}
          </span>
        </p>
      )}

      {(health.last_checkup || health.vaccinations_status) && (
        <dl className="grid gap-3 sm:grid-cols-2">
          {health.last_checkup && (
            <div className={`rounded-xl border p-4 ${TONE_TILE.trust}`}>
              <dt className="text-xs font-medium text-gray-600 dark:text-gray-300">
                {t("donorProfile.healthLastCheckup")}
              </dt>
              <dd className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                {formatDate(health.last_checkup, lang)}
              </dd>
            </div>
          )}
          {health.vaccinations_status && (
            <div className={`rounded-xl border p-4 ${TONE_TILE.sky}`}>
              <dt className="text-xs font-medium text-gray-600 dark:text-gray-300">
                {t("donorProfile.healthVaccinations")}
              </dt>
              <dd className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
                {t(`orphans.profile.vaccinationsStatusOptions.${health.vaccinations_status}`, {
                  defaultValue: health.vaccinations_status,
                })}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* H1.4b) Home — a PII-free glimpse of the child's home                 */
/* ------------------------------------------------------------------ */

/** "بيت سارة" — the gated donor home element. The backend emits this block only
 * when the supervisor left it visible AND the linked family carries at least
 * one of the two values, and it exposes ONLY the governorate (region at
 * governorate level, never finer) and the coded housing status (localized
 * through the shared families map) — never a city, street, address,
 * coordinates or income — so a present `home` is always safe to show. Each
 * tile is independently optional. */
function HomeSection({
  name,
  home,
}: {
  name: string;
  home: NonNullable<SponsoredOrphanProfile["home"]>;
}) {
  const { t } = useTranslation();
  return (
    <section className="card space-y-4" aria-label={t("donorProfile.homeTitle", { name })}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_CHIP.trust}`}
        >
          <HomeIcon />
        </span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.homeTitle", { name })}
        </h2>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {home.governorate && (
          <div className={`rounded-xl border p-4 ${TONE_TILE.trust}`}>
            <dt className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t("donorProfile.homeGovernorate")}
            </dt>
            <dd className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {home.governorate}
            </dd>
          </div>
        )}
        {home.housing_status && (
          <div className={`rounded-xl border p-4 ${TONE_TILE.sky}`}>
            <dt className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t("donorProfile.homeHousing")}
            </dt>
            <dd className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {t(`families.housingStatus.${home.housing_status}`, {
                defaultValue: home.housing_status,
              })}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* H1.4c) Guardian — who cares for the child, without identifying them  */
/* ------------------------------------------------------------------ */

/** "من يرعاها" — the gated donor guardian element. The backend emits this block
 * only when the supervisor left it visible AND the family has a guardian, and
 * it exposes ONLY the coded relation (localized through the shared families
 * map) and the occupation — never a name, phone or any identifying detail —
 * so a present `guardian` is always safe to show. */
function GuardianSection({
  name,
  guardian,
}: {
  name: string;
  guardian: NonNullable<SponsoredOrphanProfile["guardian"]>;
}) {
  const { t } = useTranslation();
  return (
    <section className="card space-y-4" aria-label={t("donorProfile.guardianTitle", { name })}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 items-center justify-center rounded-lg ${TONE_CHIP.trust}`}
        >
          <PersonIcon />
        </span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.guardianTitle", { name })}
        </h2>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border p-4 ${TONE_TILE.trust}`}>
          <dt className="text-xs font-medium text-gray-600 dark:text-gray-300">
            {t("donorProfile.guardianRelation")}
          </dt>
          <dd className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
            {t(`families.relations.${guardian.relation}`, {
              defaultValue: guardian.relation,
            })}
          </dd>
        </div>
        {guardian.occupation && (
          <div className={`rounded-xl border p-4 ${TONE_TILE.sky}`}>
            <dt className="text-xs font-medium text-gray-600 dark:text-gray-300">
              {t("donorProfile.guardianOccupation")}
            </dt>
            <dd className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {guardian.occupation}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* H1.5) In her words — curated phrases in the child's own voice        */
/* ------------------------------------------------------------------ */

type InHerWordsPhrase = NonNullable<SponsoredOrphanProfile["in_her_words"]>[number];

/** Curated child phrases as a column of quote cards. Each card opens with a
 * quote glyph, carries the phrase text, and — when present — a month+year
 * caption localized to the active language. The server has already stripped a
 * hidden/empty block, so `phrases` is always non-empty here. */
function InHerWordsSection({
  name,
  phrases,
  lang,
}: {
  name: string;
  phrases: InHerWordsPhrase[];
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("donorProfile.inHerWordsTitle", { name })} className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.inHerWordsTitle", { name })}
        </h2>
        <p className="mt-1 text-sm text-trust-600 dark:text-tranquil-200">
          {t("donorProfile.inHerWordsSubtitle")}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {phrases.map((phrase, i) => (
          <li key={i}>
            <figure className="h-full rounded-2xl border-s-4 border-trust-300 bg-tranquil-100 p-5 dark:border-trust-500/40 dark:bg-trust-500/10">
              <span className="text-trust-400 dark:text-trust-300" aria-hidden="true">
                <QuoteIcon />
              </span>
              <blockquote className="mt-1 whitespace-pre-line text-base font-medium leading-relaxed text-trust-800 dark:text-tranquil-100">
                {phrase.text}
              </blockquote>
              {phrase.said_on && (
                <figcaption className="mt-3 text-xs text-trust-600 dark:text-tranquil-200">
                  {formatMonthYear(phrase.said_on, lang)}
                </figcaption>
              )}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Month + year only (e.g. "فبراير ٢٠٢٦"), localized to the active language.
 * Falls back to the raw value when unparseable. */
function formatMonthYear(value: string, lang: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(lang, { year: "numeric", month: "long" });
}

/* ------------------------------------------------------------------ */
/* H1.6) Father's memory — a dignified, somber remembrance              */
/* ------------------------------------------------------------------ */

/** "ذكرى الأب" — the deceased father's name and the YEAR of his passing, shown
 * with deliberate restraint: a quiet, somber card (muted tones, never the
 * celebratory success palette), a "في ذمّة الله" lead, and a respectful
 * commemorative line. The backend double-gates this block (guardian consent AND
 * supervisor visibility) and exposes ONLY the name + year — never the
 * certificate or the full date — so a present `memory` is always safe to show.
 * The year is intentionally rendered as a plain integer (not date-formatted) so
 * no day/month can ever surface. */
function FatherMemorySection({
  memory,
}: {
  memory: NonNullable<SponsoredOrphanProfile["father_memory"]>;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("donorProfile.fatherMemoryTitle")}>
      <figure className="rounded-2xl border-s-4 border-trust-300 bg-tranquil-100 p-6 dark:border-trust-500/40 dark:bg-trust-500/10">
        <figcaption className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-trust-500">
          <DoveIcon />
          {t("donorProfile.fatherMemoryTitle")}
        </figcaption>
        <p className="mt-3 text-sm font-medium text-trust-600 dark:text-tranquil-200">
          {t("donorProfile.fatherMemoryInGodsCare")}
        </p>
        <p className="mt-1 text-xl font-bold text-trust-800 dark:text-tranquil-100">
          {memory.father_name}
        </p>
        {memory.death_year != null && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("donorProfile.fatherMemoryDied", { year: memory.death_year })}
          </p>
        )}
        <p className="mt-4 text-sm italic leading-relaxed text-trust-700 dark:text-tranquil-200">
          {t("donorProfile.fatherMemoryCommemoration")}
        </p>
      </figure>
    </section>
  );
}

/** A small, calm dove glyph — a quiet motif for the remembrance card. */
function DoveIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13c4 0 6-2 8-5 1.5-2.2 3.5-3 6-3 0 4-2 7-5 8" />
      <path d="M11 8c-1 4-4 7-8 8 2 2 5 3 8 3 4 0 7-3 7-7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* H2) Memory box — donor-cleared drawings / certificates / album /    */
/*     recitations. Each group is its own sub-section, shown only when  */
/*     non-empty; the whole zone disappears when nothing qualifies.     */
/* ------------------------------------------------------------------ */

type MediaBlock = NonNullable<SponsoredOrphanProfile["media"]>;
type MediaItem = MediaBlock["drawings"][number];

/** Format a duration in whole/partial seconds as m:ss. Returns null for a
 * missing or nonsensical value so the caller can omit it entirely. */
function clock(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Best available accessible label for a piece of media. */
function mediaAlt(item: MediaItem, fallback: string): string {
  return item.title?.trim() || item.caption?.trim() || fallback;
}

function MemoryBoxSection({
  name,
  media,
  lang,
}: {
  name: string;
  media: MediaBlock;
  lang: string;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<MediaItem | null>(null);

  const hasAny =
    media.drawings.length > 0 ||
    media.certificates.length > 0 ||
    media.album.length > 0 ||
    media.recitations.length > 0;

  // Defensive: the parent already guards `profile.media`, but a present
  // block with four empty groups must still render nothing (no layout shift).
  if (!hasAny) return null;

  return (
    <section
      className="space-y-5 rounded-2xl border border-trust-200 bg-gradient-to-b from-tranquil-100 to-white p-6 shadow-sm dark:border-trust-500/30 dark:from-trust-500/10 dark:to-gray-800"
      aria-label={t("donorProfile.memoryTitle", { name })}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-trust-100 text-trust-600 dark:bg-trust-500/20 dark:text-tranquil-200"
        >
          <BoxIcon />
        </span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.memoryTitle", { name })}
        </h2>
      </div>

      {media.drawings.length > 0 && (
        <DrawingsGroup name={name} items={media.drawings} lang={lang} onOpen={setActive} />
      )}
      {media.certificates.length > 0 && (
        <CertificatesGroup name={name} items={media.certificates} lang={lang} onOpen={setActive} />
      )}
      {media.album.length > 0 && (
        <AlbumGroup name={name} items={media.album} lang={lang} onOpen={setActive} />
      )}
      {media.recitations.length > 0 && (
        <RecitationsGroup name={name} items={media.recitations} lang={lang} />
      )}

      {active && <MemoryLightbox item={active} lang={lang} onClose={() => setActive(null)} />}
    </section>
  );
}

/** Shared sub-section heading for a memory-box group. */
function MemoryGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-trust-700 dark:text-tranquil-200">
        <span aria-hidden="true" className="text-trust-500 dark:text-tranquil-300">
          {icon}
        </span>
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Aspect-ratio hint from width/height so tiles don't jump as images load. */
function aspectStyle(item: MediaItem): React.CSSProperties | undefined {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return { aspectRatio: `${item.width} / ${item.height}` };
  }
  return undefined;
}

function DrawingsGroup({
  name,
  items,
  lang,
  onOpen,
}: {
  name: string;
  items: MediaItem[];
  lang: string;
  onOpen: (item: MediaItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <MemoryGroup title={t("donorProfile.memoryDrawings", { name })} icon={<PaletteIcon />}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const alt = mediaAlt(item, t("donorProfile.memoryDrawingFallback"));
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                aria-label={t("donorProfile.memoryOpenLabel", { title: alt })}
                className="group block w-full overflow-hidden rounded-xl border border-trust-100 bg-white text-start shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-trust-400 dark:border-gray-700 dark:bg-gray-800"
              >
                <img
                  src={item.thumbnail_url ?? item.url}
                  alt={alt}
                  loading="lazy"
                  style={aspectStyle(item)}
                  className="w-full bg-tranquil-100 object-cover transition group-hover:scale-[1.02] dark:bg-gray-700"
                />
                {(item.caption || item.display_date) && (
                  <span className="block px-2.5 py-2">
                    {item.caption && (
                      <span className="line-clamp-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                        {item.caption}
                      </span>
                    )}
                    <span className="mt-0.5 block text-[11px] text-gray-400 dark:text-gray-500">
                      {formatDate(item.display_date, lang)}
                    </span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </MemoryGroup>
  );
}

function CertificatesGroup({
  name,
  items,
  lang,
  onOpen,
}: {
  name: string;
  items: MediaItem[];
  lang: string;
  onOpen: (item: MediaItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <MemoryGroup title={t("donorProfile.memoryCertificates", { name })} icon={<SealIcon />}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const alt = mediaAlt(item, t("donorProfile.memoryCertificateFallback"));
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                aria-label={t("donorProfile.memoryOpenLabel", { title: alt })}
                className="group flex w-full flex-col overflow-hidden rounded-xl border border-success-200 bg-success-50/60 text-start shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-success-400 dark:border-success-500/30 dark:bg-success-500/10"
              >
                <span className="relative block">
                  <img
                    src={item.thumbnail_url ?? item.url}
                    alt={alt}
                    loading="lazy"
                    style={aspectStyle(item)}
                    className="w-full bg-white object-contain dark:bg-gray-800"
                  />
                  {/* Seal/ribbon motif — a small honor mark over the corner. */}
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-2 -end-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-success-500 text-white shadow dark:border-gray-800"
                  >
                    <SealIcon />
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="line-clamp-2 text-sm font-semibold text-success-800 dark:text-success-100">
                    {item.title?.trim() || t("donorProfile.memoryCertificateFallback")}
                  </span>
                  <span className="shrink-0 text-[11px] text-success-700/80 dark:text-success-300/80">
                    {formatDate(item.display_date, lang)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MemoryGroup>
  );
}

function AlbumGroup({
  name,
  items,
  lang,
  onOpen,
}: {
  name: string;
  items: MediaItem[];
  lang: string;
  onOpen: (item: MediaItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <MemoryGroup title={t("donorProfile.memoryAlbum", { name })} icon={<AlbumIcon />}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const alt = mediaAlt(item, t("donorProfile.memoryAlbumFallback"));
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                aria-label={t("donorProfile.memoryOpenLabel", { title: alt })}
                className="group block w-full overflow-hidden rounded-xl border border-sky-200 bg-white text-start shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-gray-700 dark:bg-gray-800"
              >
                <img
                  src={item.thumbnail_url ?? item.url}
                  alt={alt}
                  loading="lazy"
                  style={aspectStyle(item)}
                  className="w-full bg-tranquil-100 object-cover transition group-hover:scale-[1.02] dark:bg-gray-700"
                />
                <span className="block px-3 py-2.5">
                  <span className="line-clamp-2 text-sm text-gray-700 dark:text-gray-200">
                    {item.caption?.trim() || alt}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-400 dark:text-gray-500">
                    {formatDate(item.display_date, lang)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MemoryGroup>
  );
}

function RecitationsGroup({
  name,
  items,
  lang,
}: {
  name: string;
  items: MediaItem[];
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <MemoryGroup title={t("donorProfile.memoryRecitations", { name })} icon={<AudioIcon />}>
      <ul className="space-y-3">
        {items.map((item) => {
          const title = item.title?.trim() || t("donorProfile.memoryRecitationFallback");
          const dur = clock(item.duration_seconds);
          return (
            <li
              key={item.id}
              className="rounded-xl border border-trust-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-trust-800 dark:text-tranquil-100">
                  <span aria-hidden="true" className="text-trust-500 dark:text-tranquil-300">
                    <AudioIcon />
                  </span>
                  {title}
                </p>
                {dur && (
                  <span className="shrink-0 tabular-nums text-xs text-gray-400 dark:text-gray-500">
                    {dur}
                  </span>
                )}
              </div>
              {item.caption && (
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{item.caption}</p>
              )}
              <audio
                controls
                preload="none"
                src={item.url}
                aria-label={t("donorProfile.memoryAudioName", { title })}
                className="mt-2 w-full"
              />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {formatDate(item.display_date, lang)}
              </p>
            </li>
          );
        })}
      </ul>
    </MemoryGroup>
  );
}

/** Accessible full-size viewer for a memory-box image. Adds focus trap and
 * focus-return on top of the basic Esc/backdrop dismissal, and shows the
 * title / caption / date alongside the full-resolution image. */
function MemoryLightbox({
  item,
  lang,
  onClose,
}: {
  item: MediaItem;
  lang: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const alt = mediaAlt(item, t("donorProfile.memoryImageFallback"));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const node = dialogRef.current;
        if (!node) return;
        const focusables = node.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to whatever opened the dialog.
      opener?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-800"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute end-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-xl leading-none text-white transition hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          ×
        </button>
        <img
          src={item.url}
          alt={alt}
          className="max-h-[70vh] w-full bg-tranquil-100 object-contain dark:bg-gray-900"
        />
        {(item.title || item.caption || item.display_date) && (
          <div className="space-y-1 px-5 py-4">
            {item.title && (
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {item.title}
              </p>
            )}
            {item.caption && (
              <p className="text-sm text-gray-600 dark:text-gray-300">{item.caption}</p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {formatDate(item.display_date, lang)}
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* I) Timeline (existing reports)                                      */
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
    <section
      id={TIMELINE_ANCHOR}
      className="scroll-mt-6 space-y-4"
      aria-label={t("donorTimeline.timelineTitle")}
    >
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
            {formatDate(report.period_start, lang)} – {formatDate(report.period_end, lang)}
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
          {edu.attendance_percent != null && <AttendanceMeter percent={edu.attendance_percent} />}
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
          {quran.juz_memorized != null && <JuzChip value={quran.juz_memorized} />}
          {quran.evaluation && (
            <Chip tone={QURAN_EVAL_TONE[quran.evaluation] ?? "trust"}>
              {t(`orphanageManager.report.quranEvaluationOptions.${quran.evaluation}`)}
            </Chip>
          )}
          {quran.current_juz != null && (
            <Chip tone="gray">{t("donorTimeline.currentJuz", { n: quran.current_juz })}</Chip>
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

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Chip({ children, tone = "trust" }: { children: React.ReactNode; tone?: Tone }) {
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
            tone === "success" ? "bg-success-500" : tone === "sky" ? "bg-sky-400" : "bg-warning-500"
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
        <span className="block h-full rounded-full bg-success-500" style={{ width: `${pct}%` }} />
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
/* J) Sponsorship card                                                 */
/* ------------------------------------------------------------------ */

function SponsorshipCard({ sponsorship, lang }: { sponsorship: Sponsorship; lang: string }) {
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
/* K) Money trail (financial transparency)                             */
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
        <dt className="text-xs text-gray-500">{t("donor.orphanDetail.totalContributed")}</dt>
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
/* L) Impact tree — a gentle growing-tree metaphor                     */
/* ------------------------------------------------------------------ */

/** A single stylized tree whose caption translates the donor's bond into a
 * gentle metaphor: leaves ≈ whole months of sponsorship, fruits = celebrated
 * milestones, all anchored by the bond duration. We never try to draw N
 * individual leaves — the count lives in the words, not the pixels. */
function ImpactTreeSection({
  block,
}: {
  block: NonNullable<SponsoredOrphanProfile["since_you_began"]>;
}) {
  const { t } = useTranslation();
  const dur = humanDuration(block.start_date);
  const durText = dur ? formatDuration(dur, t) : null;
  const months = dur ? dur.years * 12 + dur.months : 0;
  const fruits = block.milestones_count;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.treeTitle")}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t("donorProfile.treeTitle")}
      </h2>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <svg
          viewBox="0 0 120 120"
          role="img"
          aria-label={t("donorProfile.treeAria")}
          className="h-32 w-32 shrink-0"
        >
          {/* ground line */}
          <path
            d="M22 108 H98"
            className="stroke-success-300 dark:stroke-success-500/40"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {/* trunk */}
          <rect
            x="55"
            y="64"
            width="10"
            height="44"
            rx="4"
            className="fill-warning-700 dark:fill-warning-600"
          />
          {/* foliage — three soft overlapping crowns */}
          <circle cx="60" cy="46" r="28" className="fill-success-400/90 dark:fill-success-500/40" />
          <circle cx="40" cy="56" r="19" className="fill-success-500/80 dark:fill-success-500/30" />
          <circle cx="80" cy="56" r="19" className="fill-success-500/80 dark:fill-success-500/30" />
          {/* a few fruits — golden, not counted one-per-milestone */}
          <circle cx="50" cy="48" r="3.5" className="fill-warning-500" />
          <circle cx="68" cy="40" r="3.5" className="fill-warning-500" />
          <circle cx="74" cy="56" r="3.5" className="fill-warning-500" />
          <circle cx="56" cy="62" r="3.5" className="fill-warning-500" />
        </svg>
        <div className="space-y-1 text-center sm:text-start">
          <p className="text-base font-semibold text-trust-800 dark:text-tranquil-100">
            {durText
              ? t("donorProfile.treeBond", { duration: durText })
              : t("donorProfile.treeBondNew")}
          </p>
          {(months > 0 || fruits > 0) && (
            <ul className="space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
              {months > 0 && (
                <li className="flex items-center justify-center gap-1.5 sm:justify-start">
                  <span aria-hidden="true" className="text-success-500">
                    <LeafIcon />
                  </span>
                  {t("donorProfile.treeLeaves", { n: months })}
                </li>
              )}
              {fruits > 0 && (
                <li className="flex items-center justify-center gap-1.5 sm:justify-start">
                  <span aria-hidden="true" className="text-warning-500">
                    <StarIcon />
                  </span>
                  {t("donorProfile.treeFruits", { n: fruits })}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* M) Part of something bigger — collective public stats              */
/* ------------------------------------------------------------------ */

/** Three collective figures from the PUBLIC stats endpoint, framing this
 * donor's sponsorship inside the wider effort. The query is best-effort:
 * a skeleton covers loading, and a failure omits the whole section so the
 * page never shows an error here. */
function CollectiveStatsSection() {
  const { t } = useTranslation();
  const statsQ = useQuery({
    queryKey: ["public", "stats"],
    queryFn: getPublicStats,
    retry: false,
  });

  if (statsQ.isError) return null;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.biggerTitle")}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.biggerTitle")}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("donorProfile.biggerLead")}
        </p>
      </div>
      {statsQ.isLoading || !statsQ.data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <CollectiveStat
            tone="success"
            icon={<HeartIcon />}
            value={statsQ.data.orphans_sponsored}
            label={t("donorProfile.statChildrenCared")}
          />
          <CollectiveStat
            tone="trust"
            icon={<PersonIcon />}
            value={statsQ.data.donors_total}
            label={t("donorProfile.statSponsors")}
          />
          <CollectiveStat
            tone="sky"
            icon={<GlobeIcon />}
            value={statsQ.data.countries_served}
            label={t("donorProfile.statCountries")}
          />
        </div>
      )}
    </section>
  );
}

function CollectiveStat({
  tone,
  icon,
  value,
  label,
}: {
  tone: Tone;
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <figure className={`rounded-xl border p-4 text-center ${TONE_TILE[tone]}`}>
      <span
        aria-hidden="true"
        className={`mx-auto flex h-9 w-9 items-center justify-center rounded-lg ${TONE_CHIP[tone]}`}
      >
        {icon}
      </span>
      <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {value.toLocaleString()}
      </p>
      <figcaption className="mt-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* N) Children waiting — available children + "sponsor another" CTA    */
/* ------------------------------------------------------------------ */

/** A small, dignified row of available (unsponsored) children, pulled from
 * the PUBLIC list. Best-effort: a failed/empty query simply omits the
 * section. The currently-viewed child is filtered out by code so the donor
 * is never invited to "also" sponsor the child they already support. */
function ChildrenWaitingSection({
  excludeCode,
  lang,
}: {
  excludeCode: string | null;
  lang: string;
}) {
  const { t } = useTranslation();
  // Fetch a touch more than we show so excluding the current child still
  // leaves up to three to surface.
  const waitingQ = useQuery({
    queryKey: ["public", "orphans", "waiting"],
    queryFn: () => listPublicOrphans({ limit: 4 }),
    retry: false,
  });

  if (waitingQ.isError || waitingQ.isLoading) return null;

  const items = (waitingQ.data?.items ?? []).filter((o) => o.code !== excludeCode).slice(0, 3);

  if (items.length === 0) return null;

  return (
    <section className="card space-y-4" aria-label={t("donorProfile.waitingTitle")}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donorProfile.waitingTitle")}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("donorProfile.waitingLead")}
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((o) => (
          <WaitingChildCard key={o.code} orphan={o} lang={lang} />
        ))}
      </ul>
      <div>
        <Link
          to="/orphans"
          className="inline-flex items-center gap-1.5 rounded-full bg-trust-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-trust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-trust-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
        >
          <HeartIcon />
          {t("donorProfile.waitingCta")}
          <ArrowIcon flip={lang === "ar"} />
        </Link>
      </div>
    </section>
  );
}

function WaitingChildCard({ orphan, lang }: { orphan: PublicOrphan; lang: string }) {
  const { t } = useTranslation();
  const country = orphan.country ? countryName(orphan.country, lang) : null;
  const letter = orphan.first_name.trim().charAt(0) || "•";
  return (
    <li>
      <Link
        to={`/orphans/${orphan.code}`}
        aria-label={t("donorProfile.waitingCardAria", { name: orphan.first_name })}
        className="group flex h-full items-center gap-3 rounded-xl border border-sky-200 bg-white p-3 shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-trust-400 dark:border-gray-700 dark:bg-gray-800"
      >
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-trust-300 to-trust-600 text-lg font-bold text-white"
        >
          {letter}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-gray-900 dark:text-gray-100">
            {orphan.first_name}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {t("donorProfile.waitingAge", { age: orphan.age_years })}
            {country ? ` · ${country}` : ""}
          </span>
          {orphan.partner_organization_name && (
            <span className="mt-0.5 block truncate text-xs text-trust-600 dark:text-tranquil-300">
              {orphan.partner_organization_name}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces + icons                                         */
/* ------------------------------------------------------------------ */

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{children}</dd>
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

function HomeIcon() {
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
        d="M4 11l8-6 8 6M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M8 3v4m8-4v4" strokeLinecap="round" />
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

function BoxIcon() {
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
        d="M3.5 7.5 12 4l8.5 3.5M3.5 7.5 12 11l8.5-3.5M3.5 7.5v9L12 20m8.5-12.5v9L12 20m0-9v9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaletteIcon() {
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
        d="M12 3a9 9 0 0 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-4-4-7-9-7z"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="11" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SealIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M12 2a5 5 0 0 1 5 5 5 5 0 0 1-2 4l1.4 6.3-4.4-2.4-4.4 2.4L9 11a5 5 0 0 1-2-4 5 5 0 0 1 5-5zm0 2.2A2.8 2.8 0 1 0 12 9.8 2.8 2.8 0 0 0 12 4.2z" />
    </svg>
  );
}

function AlbumIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5 17 4.5-4 3 2.5L16 11l3 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AudioIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M12 6c2-1.5 4-1.5 6-.8" strokeLinecap="round" />
      <circle cx="9" cy="16" r="3" />
    </svg>
  );
}

function LeafIcon() {
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
        d="M5 19c0-7 5-13 14-14 0 9-5 14-12 14-1.5 0-2 0-2 0z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 16c2-3 4-5 7-6" strokeLinecap="round" />
    </svg>
  );
}

/** Direction-aware arrow for "before → now". Flipped horizontally in RTL
 * so it always points from the earlier value toward the latest. */
function ArrowIcon({ flip }: { flip: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 text-gray-400 ${flip ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* I) Message archive — "أرشيف رسائلك إليها"                            */
/* ------------------------------------------------------------------ */

const ARCHIVE_QUERY_KEY = (orphanId: string) =>
  ["donor", "me", "sponsorshipMessages", orphanId] as const;

/** The donor's own thread of moderated messages to this child, plus a
 * composer. This is the donor's OWN content — fetched independently of the
 * visibility-gated profile. Each message carries a status badge; a freshly
 * sent message appears immediately as an optimistic "under review" entry and
 * is reconciled with the server on settle. */
function MessageArchiveSection({ orphanId, lang }: { orphanId: string; lang: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");

  const q = useQuery({
    queryKey: ARCHIVE_QUERY_KEY(orphanId),
    queryFn: () => listSponsorshipMessages(orphanId, { limit: 100 }),
    enabled: !!orphanId,
  });

  const send = useMutation({
    mutationFn: (text: string) => sendSponsorshipMessage(orphanId, text),
    onMutate: async (text): Promise<{ prev: Page<MessageRead> | undefined }> => {
      await queryClient.cancelQueries({ queryKey: ARCHIVE_QUERY_KEY(orphanId) });
      const prev = queryClient.getQueryData<Page<MessageRead>>(ARCHIVE_QUERY_KEY(orphanId));
      // Optimistic "under review" entry so the donor sees their note land at
      // once. The server reconciles it on settle (it lands `pending` too).
      const optimistic: MessageRead = {
        id: `optimistic-${Date.now()}`,
        from_role: "donor",
        from_name: "",
        to_role: "",
        to_name: "",
        orphan_code: null,
        message_type: "text",
        content: text,
        moderation_status: "pending",
        moderation_notes: null,
        is_read: false,
        is_mine: true,
        created_at: new Date().toISOString(),
        moderated_at: null,
        read_at: null,
      };
      queryClient.setQueryData<Page<MessageRead>>(ARCHIVE_QUERY_KEY(orphanId), (old) =>
        old
          ? { ...old, items: [optimistic, ...old.items], total: old.total + 1 }
          : { items: [optimistic], total: 1, limit: 100, offset: 0 },
      );
      return { prev };
    },
    onError: (_err, _text, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(ARCHIVE_QUERY_KEY(orphanId), ctx.prev);
      }
      toast.error(t("donor.archive.sendError"));
    },
    onSuccess: () => {
      setContent("");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ARCHIVE_QUERY_KEY(orphanId) });
    },
  });

  const trimmed = content.trim();
  const tooLong = content.length > SPONSORSHIP_MESSAGE_MAX_LEN;
  const canSend = trimmed.length > 0 && !tooLong && !send.isPending;
  const messages = q.data?.items ?? [];

  return (
    <section className="card space-y-4" aria-label={t("donor.archive.title")}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-trust-100 text-trust-600 dark:bg-trust-500/20 dark:text-tranquil-200"
        >
          <QuoteIcon />
        </span>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("donor.archive.title")}
        </h2>
      </div>

      {/* Composer — text only; the orphanage reviews before delivery. */}
      <div className="space-y-2">
        <label htmlFor="archive-compose" className="sr-only">
          {t("donor.archive.composePlaceholder")}
        </label>
        <textarea
          id="archive-compose"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={SPONSORSHIP_MESSAGE_MAX_LEN}
          rows={3}
          placeholder={t("donor.archive.composePlaceholder")}
          className="input w-full"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-trust-600 dark:text-tranquil-200">
            {t("donor.archive.composeHelper")}
          </p>
          <button
            type="button"
            onClick={() => send.mutate(trimmed)}
            disabled={!canSend}
            className="btn-primary disabled:opacity-50"
          >
            {send.isPending ? t("donor.archive.sending") : t("donor.archive.send")}
          </button>
        </div>
      </div>

      {q.isLoading && <Skeleton className="h-24 w-full" />}

      {q.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
        >
          {t("common.loadError")}
        </p>
      )}

      {q.data && messages.length === 0 && (
        <p className="rounded-lg border border-dashed border-sky-200 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t("donor.archive.empty")}
        </p>
      )}

      {messages.length > 0 && (
        <ul className="space-y-3">
          {messages.map((m) => (
            <ArchiveMessage key={m.id} message={m} lang={lang} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One message in the archive thread: a status badge, the date, the text,
 * and — for a rejected note — the moderator's reason (sender-only, already
 * filtered server-side). */
function ArchiveMessage({ message: m, lang }: { message: MessageRead; lang: string }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-xl border border-trust-100 bg-tranquil-100/50 p-3 dark:border-trust-500/30 dark:bg-trust-500/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ArchiveStatusBadge status={m.moderation_status} isRead={m.is_read} />
        <time className="text-xs text-gray-500 dark:text-gray-400" dateTime={m.created_at}>
          {formatDate(m.created_at, lang)}
        </time>
      </div>
      {m.content && (
        <p className="mt-2 whitespace-pre-line text-sm text-gray-800 dark:text-gray-200">
          {m.content}
        </p>
      )}
      {m.moderation_status === "rejected" && m.moderation_notes && (
        <p className="mt-2 rounded-lg bg-tranquil-200 px-2.5 py-1.5 text-xs text-gray-600 dark:bg-gray-700/60 dark:text-gray-300">
          <span className="font-semibold">{t("donor.archive.rejectedNoteLabel")}: </span>
          {m.moderation_notes}
        </p>
      )}
    </li>
  );
}

/** Status badge: pending (warning), approved (success) + an optional "read"
 * chip, rejected (muted/gray). Color is never the only signal — each carries
 * a localized label. */
function ArchiveStatusBadge({ status, isRead }: { status: string; isRead: boolean }) {
  const { t } = useTranslation();
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-500/15 dark:text-success-100">
          {t("donor.archive.statusApproved")}
        </span>
        {isRead && (
          <span className="rounded-full bg-tranquil-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {t("donor.archive.statusRead")}
          </span>
        )}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="rounded-full bg-tranquil-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
        {t("donor.archive.statusRejected")}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
      {t("donor.archive.statusPending")}
    </span>
  );
}
