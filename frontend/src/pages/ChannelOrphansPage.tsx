import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { getMarketingChannel } from "@/lib/marketingChannels";
import {
  type AssignmentStatus,
  type Orphan,
  listOrphans,
  releaseOrphan,
} from "@/lib/orphans";
import { toast } from "@/store/toasts";

import "./ChannelOrphansPage.css";

const STATUS_OPTIONS: AssignmentStatus[] = ["active", "expired", "all"];
type SortKey = "deadline" | "recent";

function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** Whole days from now until the deadline (negative when already past). */
function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Days elapsed since assignment as a 0–100% of the assignment window. */
function elapsedPct(assignedAt: string | null, deadline: string | null): number {
  if (!assignedAt || !deadline) return 0;
  const start = new Date(assignedAt).getTime();
  const end = new Date(deadline).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  const p = ((Date.now() - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, p));
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
}

const AVATAR_CLASSES = ["c1", "c2", "c3", "c4"] as const;
function avatarClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_CLASSES[h % AVATAR_CLASSES.length] ?? "c1";
}

/** MM-03 — channel-scoped roster of assigned orphans. Status filter
 * tabs, an urgent-deadline banner, client-side search/sort over the
 * loaded page, and a deadline-window column. Partner/country and the
 * per-orphan engagement stats in the design are not exposed by the API
 * and are deliberately omitted rather than fabricated. */
export function ChannelOrphansPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { isPartnerApprover } = useRole();
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus>("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("deadline");

  const qk = ["orphans", { channel_id: id, assignment_status: statusFilter }] as const;

  const { data: channel } = useQuery({
    queryKey: ["marketing-channel", id],
    queryFn: () => getMarketingChannel(id),
    enabled: !!id,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: qk,
    queryFn: () =>
      listOrphans({ channel_id: id, assignment_status: statusFilter, limit: 100 }),
    enabled: !!id,
  });

  const release = useMutation({
    mutationFn: (orphanId: string) => releaseOrphan(orphanId),
    onSuccess: () => {
      toast.success(t("marketing.orphans.releaseDone"));
      qc.invalidateQueries({ queryKey: qk });
      qc.invalidateQueries({ queryKey: ["marketing-channel", id, "progress"] });
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError
          ? (err.response?.data?.detail ?? t("common.loadError"))
          : t("common.loadError");
      toast.error(msg);
    },
  });

  const channelName = channel
    ? i18n.language === "ar"
      ? channel.name_ar
      : (channel.name_en ?? channel.name_ar)
    : "";

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((o) =>
          `${o.first_name} ${o.family_name} ${o.code}`.toLowerCase().includes(q),
        )
      : items.slice();
    filtered.sort((a, b) => {
      if (sort === "recent") {
        return (
          new Date(b.assigned_at ?? 0).getTime() -
          new Date(a.assigned_at ?? 0).getTime()
        );
      }
      // deadline: soonest first, nulls last
      const da = daysUntil(a.assignment_deadline);
      const db = daysUntil(b.assignment_deadline);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
    return filtered;
  }, [data, search, sort]);

  const urgentCount = (data?.items ?? []).filter((o) => {
    const d = daysUntil(o.assignment_deadline);
    return d != null && d <= 3;
  }).length;

  return (
    <div className="mmo-root">
      <div className="mmo-stack">
        {/* Header */}
        <header className="mmo-head">
          <div>
            {id && (
              <Link to={`/admin/marketing/channels/${id}`} className="mmo-back">
                ← {channelName || t("marketing.channel.eyebrow")}
              </Link>
            )}
            <h1 className="mmo-title">{t("marketing.orphans.title")}</h1>
            <p className="mmo-subtitle">{t("marketing.orphans.subtitle")}</p>
          </div>
        </header>

        {/* Urgent banner — from the loaded page only */}
        {urgentCount > 0 && (
          <div className="mmo-alert" role="alert">
            <span className="mmo-alert-ic" aria-hidden="true">
              <svg className="mmo-icon" viewBox="0 0 24 24">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <div className="mmo-alert-txt">
              <div className="mmo-alert-ttl">
                {t("marketing.orphans.urgentTitle", { n: urgentCount })}
              </div>
              <div className="mmo-alert-sub">{t("marketing.orphans.urgentBody")}</div>
            </div>
          </div>
        )}

        {/* Status filter tabs */}
        <section
          className="mmo-stat-strip"
          aria-label={t("marketing.orphans.assignmentStatus")}
        >
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`mmo-stat ${statusFilter === s ? "active" : ""}`}
              aria-pressed={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            >
              <span
                className={`mmo-stat-icon ${
                  s === "active" ? "live" : s === "expired" ? "muted" : "all"
                }`}
                aria-hidden="true"
              >
                <StatIcon status={s} />
              </span>
              <span>
                <span className="mmo-stat-lbl">
                  {t(`marketing.orphans.statuses.${s}`)}
                </span>
                <span className="mmo-stat-val mmo-num">
                  {statusFilter === s && data ? data.total.toLocaleString() : "—"}
                </span>
              </span>
            </button>
          ))}
        </section>

        {/* Filter bar */}
        <section className="mmo-filter-bar" aria-label={t("marketing.orphans.filtersLabel")}>
          <label className="mmo-search">
            <svg className="mmo-icon mmo-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("marketing.orphans.searchPlaceholder")}
              aria-label={t("marketing.orphans.searchPlaceholder")}
            />
          </label>
          <label className="sr-only" htmlFor="mmo-sort">
            {t("marketing.orphans.sortLabel")}
          </label>
          <select
            id="mmo-sort"
            className="mmo-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="deadline">{t("marketing.orphans.sortDeadline")}</option>
            <option value="recent">{t("marketing.orphans.sortRecent")}</option>
          </select>
        </section>

        {isLoading && <TableSkeleton columns={5} />}
        {error && <p className="mmo-error">{t("common.loadError")}</p>}

        {data && rows.length === 0 && (
          <div className="mmo-empty">
            {search ? t("common.noResults") : t("common.empty")}
          </div>
        )}

        {data && rows.length > 0 && (
          <>
            <div className="mmo-tbl-card">
              <div className="mmo-tbl-scroll">
                <table className="mmo-orphans">
                  <caption className="sr-only">{t("marketing.orphans.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("orphans.name")}</th>
                      <th scope="col">{t("marketing.orphans.assignedSince")}</th>
                      <th scope="col">{t("marketing.orphans.deadline")}</th>
                      <th scope="col">{t("marketing.orphans.statusColumn")}</th>
                      {isPartnerApprover && (
                        <th scope="col" className="mmo-col-actions">
                          <span className="sr-only">{t("marketing.orphans.release")}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <OrphanRow
                        key={o.id}
                        orphan={o}
                        showRelease={isPartnerApprover}
                        releasing={release.isPending}
                        onRelease={() => release.mutate(o.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* TODO(backend): partner organisation, country, and per-orphan
                engagement (views / sponsorship clicks / sponsors) shown in the
                MM-03 design are not exposed by the orphans API for marketing
                managers. Columns are omitted rather than fabricated. */}
            <p className="mmo-note">
              <svg className="mmo-icon mmo-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              {t("marketing.orphans.dataNote")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function OrphanRow({
  orphan: o,
  showRelease,
  releasing,
  onRelease,
}: {
  orphan: Orphan;
  showRelease: boolean;
  releasing: boolean;
  onRelease: () => void;
}) {
  const { t } = useTranslation();
  const age = ageFromDob(o.date_of_birth);
  const remaining = daysUntil(o.assignment_deadline);
  const since = daysSince(o.assigned_at);

  const variant =
    remaining == null
      ? null
      : remaining <= 3
        ? "urgent"
        : remaining <= 7
          ? "warn"
          : "good";
  const rowClass = variant === "urgent" ? "urgent" : variant === "warn" ? "warn-row" : "";

  return (
    <tr className={rowClass}>
      <td>
        <div className="mmo-ocell">
          <span className={`mmo-avatar ${avatarClass(o.id)}`} aria-hidden="true">
            {o.first_name?.[0] ?? ""}
            {o.family_name?.[0] ?? ""}
          </span>
          <span className="mmo-oinfo">
            <span className="mmo-nm">
              {o.first_name} {o.family_name}
              {age != null && (
                <>
                  {" · "}
                  <span className="mmo-num">{t("marketing.orphans.ageYears", { n: age })}</span>
                </>
              )}
            </span>
            <span className="mmo-ometa">
              <span className="mmo-id">{o.code}</span>
            </span>
          </span>
        </div>
      </td>
      <td>
        {since == null ? (
          <span className="mmo-none">—</span>
        ) : (
          <span className="mmo-since">{t("marketing.orphans.daysAgo", { n: since })}</span>
        )}
      </td>
      <td>
        {o.assignment_deadline == null || variant == null ? (
          <span className="mmo-none">—</span>
        ) : (
          <div className="mmo-deadline-cell">
            <div className="mmo-deadline-bar">
              <div
                className={`mmo-deadline-fill ${variant}`}
                style={{ inlineSize: `${elapsedPct(o.assigned_at, o.assignment_deadline)}%` }}
              />
            </div>
            <div className="mmo-deadline-text">
              <span className={`mmo-badge ${variant}`}>
                <DeadlineIcon variant={variant} />
                {remaining != null && remaining <= 0
                  ? t("marketing.orphans.expired")
                  : t("marketing.orphans.daysLeft", { n: remaining })}
              </span>
            </div>
          </div>
        )}
      </td>
      <td>
        <CaseStatusChip status={o.case_status} sponsored={o.is_sponsored} />
      </td>
      {showRelease && (
        <td className="mmo-col-actions">
          <button
            type="button"
            className="mmo-release"
            onClick={onRelease}
            disabled={releasing}
          >
            {t("marketing.orphans.release")}
          </button>
        </td>
      )}
    </tr>
  );
}

function CaseStatusChip({
  status,
  sponsored,
}: {
  status: string;
  sponsored: boolean;
}) {
  const { t } = useTranslation();
  const variant =
    sponsored || status === "sponsored"
      ? "sponsored"
      : status === "approved" || status === "available"
        ? "available"
        : status === "reserved" || status === "pending_review"
          ? "viewed"
          : "neutral";
  return (
    <span className={`mmo-chip ${variant}`}>
      {t(`orphans.caseStatus.${status}`, status)}
    </span>
  );
}

function StatIcon({ status }: { status: AssignmentStatus }) {
  if (status === "active") {
    return (
      <svg className="mmo-icon mmo-icon-sm" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <polyline points="9 12 11 14 15 10" />
      </svg>
    );
  }
  if (status === "expired") {
    return (
      <svg className="mmo-icon mmo-icon-sm" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  return (
    <svg className="mmo-icon mmo-icon-sm" viewBox="0 0 24 24">
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
    </svg>
  );
}

function DeadlineIcon({ variant }: { variant: "good" | "warn" | "urgent" }) {
  if (variant === "good") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (variant === "warn") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
