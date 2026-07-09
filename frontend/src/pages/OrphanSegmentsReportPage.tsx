import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { OrphanFilterControls } from "@/components/OrphanFilterControls";
import { StatGridSkeleton } from "@/components/Skeleton";
import {
  type SegmentBucket,
  type SegmentDimension,
  getOrphanSegments,
} from "@/lib/orphans";
import {
  EMPTY_ORPHAN_SLICE,
  type OrphanSliceFilters,
  orphanSliceParams,
  orphanSliceToSearchParams,
} from "@/lib/orphanSlice";

import "./OrphanSegmentsReportPage.css";

// Mirrors the backend SegmentDimension Literal — the selector offers every
// dimension the endpoint groups by, in the same order.
const DIMENSIONS: readonly SegmentDimension[] = [
  "case_status",
  "education_stage",
  "health_status",
  "gender",
  "priority",
  "lives_with",
  "orphan_type",
  "hafiz",
  "juz_band",
  "age_band",
  "orphanage",
  "partner",
  "channel",
  "governorate",
] as const;

// The dimensions the backend applies its k-anonymity floor to (buckets under
// SEGMENT_MIN_BUCKET collapse into "other") — the privacy note shows only for
// these.
const SENSITIVE_DIMENSIONS: ReadonlySet<SegmentDimension> = new Set([
  "governorate",
  "orphanage",
]);

// Same working vocabulary as the orphan list's status tabs.
const CASE_STATUS_OPTIONS = [
  "pending_review",
  "approved",
  "available",
  "reserved",
  "sponsored",
  "graduated",
] as const;

export function OrphanSegmentsReportPage() {
  const { t, i18n } = useTranslation();
  const [by, setBy] = useState<SegmentDimension>("case_status");
  // The slice: the exact same filter panel (and state shape) as the staff
  // orphan list, so the report is always "the filtered list, grouped".
  const [slice, setSlice] = useState<OrphanSliceFilters>(EMPTY_ORPHAN_SLICE);
  const [caseStatus, setCaseStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 300ms debounce on the search box — mirrors OrphansPage.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["orphan-segments", { by, caseStatus, q: debouncedSearch, ...slice }],
    queryFn: () =>
      getOrphanSegments({
        by,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        ...(caseStatus ? { case_status: caseStatus } : {}),
        ...orphanSliceParams(slice),
      }),
  });

  const buckets = data?.buckets ?? [];
  const total = data?.total ?? 0;
  const top = buckets[0];
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  /** Human label for one bucket: the special buckets and the coded
   * dimensions map through i18n; joined dimensions carry their own label. */
  function bucketDisplay(bucket: SegmentBucket): string {
    if (bucket.key === "unspecified") return t("orphanSegments.buckets.unspecified");
    if (bucket.key === "other") return t("orphanSegments.buckets.other");
    if (bucket.label) return bucket.label;
    switch (by) {
      case "case_status":
        return t(`orphans.caseStatus.${bucket.key}`, bucket.key);
      case "education_stage":
        return t(`orphans.profile.educationStageOptions.${bucket.key}`, bucket.key);
      case "health_status":
        return t(`orphans.profile.healthStatusOptions.${bucket.key}`, bucket.key);
      case "priority":
        return t(`orphans.profile.priorityLevelOptions.${bucket.key}`, bucket.key);
      case "gender":
        return bucket.key === "M" ? t("orphans.male") : t("orphans.female");
      case "lives_with":
        return t(`orphans.livesWithOptions.${bucket.key}`, bucket.key);
      case "orphan_type":
        return t(`orphans.filters.orphanTypeOptions.${bucket.key}`, bucket.key);
      case "hafiz":
        return t(`orphanSegments.buckets.hafiz.${bucket.key}`, bucket.key);
      case "juz_band":
        return t(`orphanSegments.buckets.juzBand.${bucket.key}`, bucket.key);
      case "age_band":
        return t(`orphanSegments.buckets.ageBand.${bucket.key}`, bucket.key);
      default:
        return bucket.key;
    }
  }

  /** Deep-link into the staff orphan list carrying the report's slice, plus —
   * where the list has a matching filter — the row's own bucket value. For
   * dimensions the list can't filter by (gender, bands, joined dims) the link
   * still carries the slice, so the user lands on the same population. */
  function orphansLink(bucket?: SegmentBucket): string {
    const sp = orphanSliceToSearchParams(slice);
    if (debouncedSearch) sp.set("q", debouncedSearch);
    if (caseStatus) sp.set("status", caseStatus);
    if (bucket && bucket.key !== "unspecified" && bucket.key !== "other") {
      switch (by) {
        case "case_status":
          sp.set("status", bucket.key);
          break;
        case "education_stage":
          sp.set("education_stage", bucket.key);
          break;
        case "health_status":
          sp.set("health_status", bucket.key);
          break;
        case "priority":
          sp.set("priority", bucket.key);
          break;
        case "hafiz":
          sp.set("is_hafiz", bucket.key === "yes" ? "true" : "false");
          break;
        case "orphan_type":
          if (bucket.key !== "unknown") sp.set("orphan_type", bucket.key);
          break;
        default:
          break;
      }
    }
    const qs = sp.toString();
    return qs ? `/admin/orphans?${qs}` : "/admin/orphans";
  }

  return (
    <div className="ps-orphans osr-page">
      <div className="ps-orphans-header">
        <div>
          <h1>{t("orphanSegments.title")}</h1>
          <p>{t("orphanSegments.subtitle")}</p>
        </div>
      </div>

      {/* Dimension selector + the shared orphan-list filter panel */}
      <div className="ps-filter-bar">
        <label className="osr-by-label" htmlFor="osr-by">
          {t("orphanSegments.dimension")}
        </label>
        <select
          id="osr-by"
          className="ps-filter-select"
          value={by}
          onChange={(e) => setBy(e.target.value as SegmentDimension)}
        >
          {DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              {t(`orphanSegments.dimensions.${d}`)}
            </option>
          ))}
        </select>

        <div className="ps-search">
          <input
            type="search"
            placeholder={t("orphans.searchPlaceholder")}
            aria-label={t("orphans.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <select
          className="ps-filter-select"
          aria-label={t("orphans.status")}
          value={caseStatus}
          onChange={(e) => setCaseStatus(e.target.value)}
        >
          <option value="">{t("orphans.allStatuses")}</option>
          {CASE_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`orphans.caseStatus.${s}`, s)}
            </option>
          ))}
        </select>

        <OrphanFilterControls value={slice} onChange={setSlice} />
      </div>

      {/* k-anonymity note — only for the sensitive geographic dimensions. */}
      {SENSITIVE_DIMENSIONS.has(by) && (
        <p className="osr-privacy-note">{t("orphanSegments.privacyNote")}</p>
      )}

      {isLoading && <StatGridSkeleton cards={3} />}
      {error != null && <p className="ps-orphans-error">{t("common.loadError")}</p>}

      {data && (
        <>
          <div className="osr-cards">
            <div className="osr-card">
              <span className="osr-card-label">{t("orphanSegments.cards.total")}</span>
              <span className="osr-card-value latin">{total.toLocaleString(i18n.language)}</span>
            </div>
            <div className="osr-card">
              <span className="osr-card-label">{t("orphanSegments.cards.categories")}</span>
              <span className="osr-card-value latin">
                {buckets.length.toLocaleString(i18n.language)}
              </span>
            </div>
            <div className="osr-card">
              <span className="osr-card-label">{t("orphanSegments.cards.top")}</span>
              <span className="osr-card-value">{top ? bucketDisplay(top) : "—"}</span>
              {top && (
                <span className="osr-card-sub latin">{top.count.toLocaleString(i18n.language)}</span>
              )}
            </div>
          </div>

          {buckets.length === 0 && (
            <div className="ps-table-card">
              <p className="ps-orphans-msg">{t("common.empty")}</p>
            </div>
          )}

          {buckets.length > 0 && (
            <>
              <section className="ps-table-card osr-chart" aria-label={t("orphanSegments.chartTitle")}>
                <h2>{t("orphanSegments.chartTitle")}</h2>
                <ul className="osr-bars">
                  {buckets.map((b) => (
                    <li key={b.key}>
                      <div className="osr-bar-meta">
                        <span className="osr-bar-label">{bucketDisplay(b)}</span>
                        <span className="osr-bar-value latin">
                          {b.count.toLocaleString(i18n.language)}
                        </span>
                      </div>
                      <div className="osr-bar-track">
                        <div
                          className="osr-bar-fill"
                          style={{ inlineSize: `${((b.count / maxCount) * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="ps-table-card">
                <div className="ps-table-wrap">
                  <table className="ps-t">
                    <thead>
                      <tr>
                        <th>{t("orphanSegments.table.category")}</th>
                        <th>{t("orphanSegments.table.count")}</th>
                        <th>{t("orphanSegments.table.share")}</th>
                        <th className="action-col">{t("orphans.actionsCol")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map((b) => (
                        <tr key={b.key}>
                          <td>{bucketDisplay(b)}</td>
                          <td className="ps-cell-num latin">
                            {b.count.toLocaleString(i18n.language)}
                          </td>
                          <td className="ps-cell-num latin">
                            {total > 0 ? `${((b.count / total) * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td>
                            <Link className="osr-view-link" to={orphansLink(b)}>
                              {t("orphanSegments.table.view")}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
