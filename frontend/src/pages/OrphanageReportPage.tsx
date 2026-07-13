import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { StatGridSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import {
  type OrphanageReport,
  getOrphanageReport,
  listOrphanages,
} from "@/lib/orphanages";
import { getOrphanageMe } from "@/lib/orphanageSelf";
import type { components } from "@/api/schema.gen";

import "./OrphanageReportPage.css";

type SegmentBucket = components["schemas"]["SegmentBucket"];

// Mirrors the backend's FILE_INCOMPLETE_THRESHOLD — only used to LABEL the
// incomplete-files figures; the counting itself happens server-side.
const FILE_INCOMPLETE_THRESHOLD = 80;

/**
 * Read-only "house report" for one dar: occupancy against capacity,
 * collective health / education breakdowns, sponsorship coverage and the
 * reporting-cadence tallies (on track / due soon / overdue against the
 * org's cadence). Counts only — no individual resident records.
 *
 * The orphanage_manager is pinned to the single dar they run (no picker);
 * admins and partner managers pick from the dars their scope returns. The
 * backend enforces both — the pinning here is UX, not security.
 */
export function OrphanageReportPage() {
  const { t, i18n } = useTranslation();
  const { role, isOrphanageManager } = useRole();
  const isAr = i18n.language === "ar";
  const [selectedId, setSelectedId] = useState("");

  // Wait for the role before firing either query: a manager must never hit
  // the staff list (403) and staff must never hit /orphanage/me (404).
  const roleReady = role !== undefined;
  const myDar = useQuery({
    queryKey: ["orphanage", "me"],
    queryFn: getOrphanageMe,
    enabled: roleReady && isOrphanageManager,
  });
  const dars = useQuery({
    queryKey: ["orphanages", "report-picker"],
    queryFn: () => listOrphanages({ limit: 100 }),
    enabled: roleReady && !isOrphanageManager,
  });

  // Admins land on the first dar of their scope; the manager is pinned.
  const pickerItems = dars.data?.items ?? [];
  useEffect(() => {
    const first = dars.data?.items[0];
    if (!isOrphanageManager && !selectedId && first) {
      setSelectedId(first.id);
    }
  }, [isOrphanageManager, selectedId, dars.data]);

  const orphanageId = isOrphanageManager ? (myDar.data?.id ?? "") : selectedId;
  const orphanageName = isOrphanageManager
    ? darName(myDar.data, isAr)
    : darName(
        pickerItems.find((o) => o.id === selectedId),
        isAr,
      );

  const { data, isLoading, error } = useQuery({
    queryKey: ["orphanage-report", orphanageId],
    queryFn: () => getOrphanageReport(orphanageId),
    enabled: orphanageId !== "",
  });

  const sourcesPending =
    !roleReady || (isOrphanageManager ? myDar.isLoading : dars.isLoading);
  const sourceError = isOrphanageManager ? myDar.error : dars.error;

  return (
    <div className="ps-orphans ohr-page">
      <div className="ps-orphans-header">
        <div>
          <h1>{t("orphanageReport.title")}</h1>
          <p>{t("orphanageReport.subtitle")}</p>
        </div>
      </div>

      {/* Orphanage picker — the manager sees their house pinned instead. */}
      <div className="ps-filter-bar">
        <label className="ohr-picker-label" htmlFor="ohr-picker">
          {t("orphanageReport.picker")}
        </label>
        {isOrphanageManager ? (
          <span className="ohr-pinned" data-testid="ohr-pinned-house">
            {orphanageName || "…"}
          </span>
        ) : (
          <select
            id="ohr-picker"
            className="ps-filter-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {pickerItems.length === 0 && (
              <option value="">{t("orphanageReport.noHouses")}</option>
            )}
            {pickerItems.map((o) => (
              <option key={o.id} value={o.id}>
                {darName(o, isAr)}
              </option>
            ))}
          </select>
        )}
      </div>

      {(sourcesPending || isLoading) && <StatGridSkeleton cards={4} />}
      {(sourceError != null || error != null) && (
        <p className="ps-orphans-error">{t("common.loadError")}</p>
      )}
      {!sourcesPending && !isOrphanageManager && pickerItems.length === 0 && !dars.error && (
        <div className="ps-table-card">
          <p className="ps-orphans-msg">{t("orphanageReport.noHouses")}</p>
        </div>
      )}

      {data && <ReportBody report={data} />}
    </div>
  );
}

function darName(
  dar: { name_ar: string; name_en: string } | undefined,
  isAr: boolean,
): string {
  if (!dar) return "";
  return isAr ? dar.name_ar : dar.name_en || dar.name_ar;
}

function ReportBody({ report }: { report: OrphanageReport }) {
  const { t, i18n } = useTranslation();
  const { occupancy, sponsorship, files, reporting } = report;
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  /** i18n label for a coded bucket; NULLs arrive as the "unspecified" key
   * (reuses the segments-report bucket label). */
  const bucketLabel = (bucket: SegmentBucket, namespace: string): string =>
    bucket.key === "unspecified"
      ? t("orphanSegments.buckets.unspecified")
      : t(`${namespace}.${bucket.key}`, bucket.key);

  const overBy =
    occupancy.capacity != null ? occupancy.residents - occupancy.capacity : 0;
  // The cadence the backend classified against, labelled honestly — the
  // KPI tag also names the grace period that separates due-soon from
  // overdue.
  const cadenceLabel = t("orphanageReport.reporting.cadenceLabel", {
    days: reporting.cadence_days,
  });
  const cadenceWithGrace = t("orphanageReport.reporting.cadenceWithGrace", {
    days: reporting.cadence_days,
    grace: reporting.grace_days,
  });

  return (
    <>
      {/* ── Alerts — over-capacity and incomplete files ─────────────── */}
      {occupancy.over && (
        <div role="alert" className="ohr-alert ohr-alert-danger">
          {t("orphanageReport.alerts.overCapacity", {
            residents: fmt(occupancy.residents),
            capacity: fmt(occupancy.capacity ?? 0),
          })}
        </div>
      )}
      {files.incomplete_count > 0 && (
        <div role="alert" className="ohr-alert ohr-alert-warn">
          {t("orphanageReport.alerts.incompleteFiles", {
            n: fmt(files.incomplete_count),
            threshold: FILE_INCOMPLETE_THRESHOLD,
          })}
        </div>
      )}

      {/* ── Occupancy gauge ─────────────────────────────────────────── */}
      <section
        className={`ps-table-card ohr-gauge-card${occupancy.over ? " ohr-gauge-card-over" : ""}`}
        aria-label={t("orphanageReport.occupancy.title")}
      >
        <h2>{t("orphanageReport.occupancy.title")}</h2>
        <div className="ohr-gauge-figures">
          <span className="ohr-gauge-value latin">
            {fmt(occupancy.residents)}
            {occupancy.capacity != null && (
              <span className="ohr-gauge-capacity"> / {fmt(occupancy.capacity)}</span>
            )}
          </span>
          <span className="ohr-gauge-sub">
            {occupancy.capacity == null
              ? t("orphanageReport.occupancy.capacityNotRecorded")
              : occupancy.occupancy_pct != null
                ? t("orphanageReport.occupancy.pctOfCapacity", {
                    pct: fmt(occupancy.occupancy_pct),
                  })
                : t("orphanageReport.occupancy.capacityZero")}
          </span>
        </div>
        {occupancy.occupancy_pct != null && (
          <div className="ohr-gauge-track">
            <div
              className={`ohr-gauge-fill${occupancy.over ? " ohr-gauge-fill-over" : ""}`}
              style={{ inlineSize: `${Math.min(occupancy.occupancy_pct, 100)}%` }}
            />
          </div>
        )}
        {occupancy.capacity != null && (
          <p className={`ohr-gauge-note${occupancy.over ? " ohr-gauge-note-over" : ""}`}>
            {occupancy.over
              ? t("orphanageReport.occupancy.overBy", { n: fmt(overBy) })
              : t("orphanageReport.occupancy.freePlaces", {
                  n: fmt(occupancy.free ?? 0),
                })}
          </p>
        )}
      </section>

      {/* ── KPI cards ───────────────────────────────────────────────── */}
      <div className="ohr-cards">
        <div className="ohr-card">
          <span className="ohr-card-label">{t("orphanageReport.cards.residents")}</span>
          <span className="ohr-card-value latin">{fmt(occupancy.residents)}</span>
        </div>
        <div className="ohr-card">
          <span className="ohr-card-label">{t("orphanageReport.cards.sponsored")}</span>
          <span className="ohr-card-value latin">{fmt(sponsorship.sponsored)}</span>
          <span className="ohr-card-sub latin">
            {sponsorship.sponsored_pct != null
              ? t("orphanageReport.cards.sponsoredPct", {
                  pct: fmt(sponsorship.sponsored_pct),
                })
              : "—"}
          </span>
        </div>
        <div className="ohr-card">
          <span className="ohr-card-label">{t("orphanageReport.cards.avgCompletion")}</span>
          <span className="ohr-card-value latin">
            {files.avg_completion != null ? `${fmt(files.avg_completion)}%` : "—"}
          </span>
          <span className="ohr-card-sub latin">
            {t("orphanageReport.cards.incompleteFiles", {
              n: fmt(files.incomplete_count),
              threshold: FILE_INCOMPLETE_THRESHOLD,
            })}
          </span>
        </div>
        <div className="ohr-card">
          <span className="ohr-card-label">
            {t("orphanageReport.cards.onTrack")}
            <span className="ohr-card-tag">{cadenceWithGrace}</span>
          </span>
          <span className="ohr-card-value latin">
            {fmt(reporting.on_track)}
            <span className="ohr-gauge-capacity"> / {fmt(occupancy.residents)}</span>
          </span>
          <span className="ohr-card-sub latin">
            {t("orphanageReport.cards.dueSoonOverdue", {
              dueSoon: fmt(reporting.due_soon),
              overdue: fmt(reporting.overdue),
            })}
          </span>
        </div>
      </div>

      {/* ── Breakdown panels ────────────────────────────────────────── */}
      <div className="ohr-panels">
        <BreakdownPanel
          title={t("orphanageReport.panels.health")}
          items={report.health.map((b) => ({
            key: b.key,
            label: bucketLabel(b, "orphans.profile.healthStatusOptions"),
            count: b.count,
          }))}
        />
        <BreakdownPanel
          title={t("orphanageReport.panels.education")}
          items={report.education.map((b) => ({
            key: b.key,
            label: bucketLabel(b, "orphans.profile.educationStageOptions"),
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
        <BreakdownPanel
          title={`${t("orphanageReport.panels.reporting")} — ${cadenceLabel}`}
          items={[
            {
              key: "on_track",
              label: t("orphanageReport.reporting.onTrack"),
              count: reporting.on_track,
            },
            {
              key: "due_soon",
              label: t("orphanageReport.reporting.dueSoon"),
              count: reporting.due_soon,
            },
            {
              key: "overdue",
              label: t("orphanageReport.reporting.overdue"),
              count: reporting.overdue,
            },
          ]}
          hideWhenAllZero
        />
      </div>
    </>
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
    <section className="ps-table-card ohr-panel" aria-label={title}>
      <h2>{title}</h2>
      {empty ? (
        <p className="ps-orphans-msg">{t("common.empty")}</p>
      ) : (
        <ul className="ohr-bars">
          {items.map((item) => (
            <li key={item.key}>
              <div className="ohr-bar-meta">
                <span className="ohr-bar-label">{item.label}</span>
                <span className="ohr-bar-value latin">
                  {item.count.toLocaleString(i18n.language)}
                </span>
              </div>
              <div className="ohr-bar-track">
                <div
                  className="ohr-bar-fill"
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
