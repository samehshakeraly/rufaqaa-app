import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { StatGridSkeleton } from "@/components/Skeleton";
import {
  type CommunityFollowupReport,
  type GovernorateFollowup,
  getCommunityFollowupReport,
} from "@/lib/communityFollowup";
import type { components } from "@/api/schema.gen";

import "./CommunityFollowupReportPage.css";

type SegmentBucket = components["schemas"]["SegmentBucket"];

// Mirrors the backend's FILE_INCOMPLETE_THRESHOLD / SEGMENT_MIN_BUCKET —
// only used to LABEL the figures; the counting and the k-anonymity
// collapse both happen server-side.
const FILE_INCOMPLETE_THRESHOLD = 80;
const SEGMENT_MIN_BUCKET = 3;

// Follow-up tier boundaries for the per-governorate badge, computed over
// the ON-TRACK share: ≥80% good, 60–79% fair, below 60% needs follow-up
// (also the alert threshold).
const TIER_GOOD_PCT = 80;
const TIER_OK_PCT = 60;

type GovSort = "most" | "weakest";
type Tier = "good" | "ok" | "low";

function onTrackPct(g: GovernorateFollowup): number {
  return g.count > 0 ? Math.round((g.on_track / g.count) * 100) : 0;
}

function tierOf(pct: number): Tier {
  if (pct >= TIER_GOOD_PCT) return "good";
  if (pct >= TIER_OK_PCT) return "ok";
  return "low";
}

/**
 * Read-only "community follow-up" report over the OUT-OF-HOME orphans —
 * children living with their families rather than in a dar (the exact
 * complement of the house report's residents). Geographic spread by the
 * FAMILY governorate crossed with follow-up regularity, plus lives-with /
 * health / sponsorship / file-completion aggregates. Counts only — no
 * individual child records; sub-threshold governorates arrive from the
 * backend already merged into "other".
 */
export function CommunityFollowupReportPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["community-followup-report"],
    queryFn: getCommunityFollowupReport,
  });

  return (
    <div className="ps-orphans cfr-page">
      <div className="ps-orphans-header">
        <div>
          <h1>{t("communityFollowup.title")}</h1>
          <p>{t("communityFollowup.subtitle")}</p>
        </div>
      </div>

      {isLoading && <StatGridSkeleton cards={4} />}
      {error != null && <p className="ps-orphans-error">{t("common.loadError")}</p>}
      {data && <ReportBody report={data} />}
    </div>
  );
}

function ReportBody({ report }: { report: CommunityFollowupReport }) {
  const { t, i18n } = useTranslation();
  const { reporting, sponsorship, files } = report;
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  /** i18n label for a coded bucket; NULLs arrive as the "unspecified" key
   * (reuses the segments-report bucket label). */
  const bucketLabel = (bucket: SegmentBucket, namespace: string): string =>
    bucket.key === "unspecified"
      ? t("orphanSegments.buckets.unspecified")
      : t(`${namespace}.${bucket.key}`, bucket.key);

  /** Governorate keys are the raw names except the two synthetic buckets. */
  const govLabel = (key: string): string =>
    key === "unspecified"
      ? t("orphanSegments.buckets.unspecified")
      : key === "other"
        ? t("orphanSegments.buckets.other")
        : key;

  // The cadence the backend classified against, labelled honestly — the
  // KPI tag also names the grace period that separates due-soon from
  // overdue.
  const cadenceWithGrace = t("orphanageReport.reporting.cadenceWithGrace", {
    days: reporting.cadence_days,
    grace: reporting.grace_days,
  });
  // Named governorates only — "unspecified" is no governorate and "other"
  // is the merge of several small ones, so neither inflates the KPI.
  const namedGovernorates = report.governorates.filter(
    (g) => g.governorate !== "unspecified" && g.governorate !== "other",
  ).length;
  const onTrackShare =
    report.total > 0 ? Math.round((reporting.on_track * 100) / report.total) : null;
  // Every real governorate row (named + the merged "other") with weak
  // follow-up — "unspecified" is excluded: it is not a place to visit.
  const lowGovernorates = report.governorates.filter(
    (g) => g.governorate !== "unspecified" && onTrackPct(g) < TIER_OK_PCT,
  );

  return (
    <>
      {/* ── Alerts — overdue children, weak governorates ─────────────── */}
      {reporting.overdue > 0 && (
        <div role="alert" className="cfr-alert cfr-alert-warn">
          {t("communityFollowup.alerts.overdue", {
            n: fmt(reporting.overdue),
            days: reporting.cadence_days,
            grace: reporting.grace_days,
          })}
        </div>
      )}
      {lowGovernorates.length > 0 && (
        <div role="alert" className="cfr-alert cfr-alert-danger">
          {t("communityFollowup.alerts.lowGovernorates", {
            pct: TIER_OK_PCT,
            names: lowGovernorates.map((g) => govLabel(g.governorate)).join("، "),
          })}
        </div>
      )}

      {/* ── KPI cards ───────────────────────────────────────────────── */}
      <div className="cfr-cards">
        <div className="cfr-card">
          <span className="cfr-card-label">{t("communityFollowup.cards.total")}</span>
          <span className="cfr-card-value latin" data-testid="cfr-kpi-total">
            {fmt(report.total)}
          </span>
        </div>
        <div className="cfr-card">
          <span className="cfr-card-label">{t("communityFollowup.cards.governorates")}</span>
          <span className="cfr-card-value latin" data-testid="cfr-kpi-governorates">
            {fmt(namedGovernorates)}
          </span>
        </div>
        <div className="cfr-card">
          <span className="cfr-card-label">
            {t("orphanageReport.cards.onTrack")}
            <span className="cfr-card-tag">{cadenceWithGrace}</span>
          </span>
          <span className="cfr-card-value latin" data-testid="cfr-kpi-on-track">
            {onTrackShare != null ? `${fmt(onTrackShare)}%` : "—"}
          </span>
          <span className="cfr-card-sub latin">
            {t("orphanageReport.cards.dueSoonOverdue", {
              dueSoon: fmt(reporting.due_soon),
              overdue: fmt(reporting.overdue),
            })}
          </span>
        </div>
        <div className="cfr-card">
          <span className="cfr-card-label">{t("orphanageReport.cards.avgCompletion")}</span>
          <span className="cfr-card-value latin" data-testid="cfr-kpi-completion">
            {files.avg_completion != null ? `${fmt(files.avg_completion)}%` : "—"}
          </span>
          <span className="cfr-card-sub latin">
            {t("orphanageReport.cards.incompleteFiles", {
              n: fmt(files.incomplete_count),
              threshold: FILE_INCOMPLETE_THRESHOLD,
            })}
          </span>
        </div>
      </div>

      <GeoFollowupPanel governorates={report.governorates} govLabel={govLabel} />

      {/* ── Breakdown panels ────────────────────────────────────────── */}
      <div className="cfr-panels">
        <BreakdownPanel
          title={t("communityFollowup.panels.livesWith")}
          items={report.lives_with.map((b) => ({
            key: b.key,
            label: bucketLabel(b, "orphans.livesWithOptions"),
            count: b.count,
          }))}
        />
        <BreakdownPanel
          title={t("communityFollowup.panels.health")}
          items={report.health.map((b) => ({
            key: b.key,
            label: bucketLabel(b, "orphans.profile.healthStatusOptions"),
            count: b.count,
          }))}
        />
        <BreakdownPanel
          title={t("orphanageReport.panels.sponsorship")}
          items={[
            {
              key: "sponsored",
              label: t("orphans.caseStatus.sponsored"),
              count: sponsorship.sponsored,
            },
            {
              key: "unsponsored",
              label: t("orphanageReport.sponsorshipLabels.unsponsored"),
              count: sponsorship.unsponsored,
            },
          ]}
          hideWhenAllZero
        />
      </div>

      <p className="cfr-privacy">
        {t("communityFollowup.privacyNote", { min: SEGMENT_MIN_BUCKET })}
      </p>
    </>
  );
}

/** The signature panel: one row per governorate — bar length is the
 * headcount, the solid segment its on-track share, the amber segment the
 * due-soon share (the remaining tint is overdue), the badge the follow-up
 * tier. Sortable by size or by weakest follow-up first. */
function GeoFollowupPanel({
  governorates,
  govLabel,
}: {
  governorates: GovernorateFollowup[];
  govLabel: (key: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState<GovSort>("most");
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  // The backend already orders by count desc with a stable key tiebreak
  // (the "most" order); "weakest" re-sorts by on-track share ascending.
  const rows = useMemo(() => {
    if (sort === "most") return governorates;
    return [...governorates].sort(
      (a, b) =>
        onTrackPct(a) - onTrackPct(b) ||
        b.count - a.count ||
        a.governorate.localeCompare(b.governorate),
    );
  }, [governorates, sort]);
  const maxCount = Math.max(...governorates.map((g) => g.count), 1);

  return (
    <section className="ps-table-card cfr-geo" aria-label={t("communityFollowup.geo.title")}>
      <div className="cfr-geo-head">
        <h2>{t("communityFollowup.geo.title")}</h2>
        <div className="cfr-sort" role="group" aria-label={t("communityFollowup.geo.sortLabel")}>
          <button
            type="button"
            className={`cfr-sort-btn${sort === "most" ? " cfr-sort-btn-active" : ""}`}
            aria-pressed={sort === "most"}
            onClick={() => setSort("most")}
          >
            {t("communityFollowup.geo.sortMost")}
          </button>
          <button
            type="button"
            className={`cfr-sort-btn${sort === "weakest" ? " cfr-sort-btn-active" : ""}`}
            aria-pressed={sort === "weakest"}
            onClick={() => setSort("weakest")}
          >
            {t("communityFollowup.geo.sortWeakest")}
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="ps-orphans-msg">{t("common.empty")}</p>
      ) : (
        <ul className="cfr-gov-rows">
          {rows.map((g) => {
            const pct = onTrackPct(g);
            const tier = tierOf(pct);
            const dueSoonShare = g.count > 0 ? Math.round((g.due_soon / g.count) * 100) : 0;
            return (
              <li key={g.governorate} className="cfr-gov-row" data-testid="cfr-gov-row">
                <div className="cfr-gov-meta">
                  <span className="cfr-gov-name">{govLabel(g.governorate)}</span>
                  <span className={`cfr-tier cfr-tier-${tier}`}>
                    {t(`communityFollowup.geo.tier.${tier}`)}
                  </span>
                  <span className="cfr-gov-figures latin">
                    {t("communityFollowup.geo.tallies", {
                      onTrack: fmt(g.on_track),
                      count: fmt(g.count),
                      pct: fmt(pct),
                      dueSoon: fmt(g.due_soon),
                      overdue: fmt(g.overdue),
                    })}
                  </span>
                </div>
                <div className="cfr-gov-track">
                  <div
                    className="cfr-gov-count"
                    style={{ inlineSize: `${((g.count / maxCount) * 100).toFixed(1)}%` }}
                  >
                    <div className="cfr-gov-on-track" style={{ inlineSize: `${pct}%` }} />
                    <div className="cfr-gov-due-soon" style={{ inlineSize: `${dueSoonShare}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BreakdownPanel({
  title,
  items,
  hideWhenAllZero = false,
}: {
  title: string;
  items: Array<{ key: string; label: string; count: number }>;
  hideWhenAllZero?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const maxCount = Math.max(...items.map((item) => item.count), 1);
  const empty = items.length === 0 || (hideWhenAllZero && total === 0);

  return (
    <section className="ps-table-card cfr-panel" aria-label={title}>
      <h2>{title}</h2>
      {empty ? (
        <p className="ps-orphans-msg">{t("common.empty")}</p>
      ) : (
        <ul className="cfr-bars">
          {items.map((item) => (
            <li key={item.key}>
              <div className="cfr-bar-meta">
                <span className="cfr-bar-label">{item.label}</span>
                <span className="cfr-bar-value latin">
                  {item.count.toLocaleString(i18n.language)}
                </span>
              </div>
              <div className="cfr-bar-track">
                <div
                  className="cfr-bar-fill"
                  style={{ inlineSize: `${((item.count / maxCount) * 100).toFixed(1)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
