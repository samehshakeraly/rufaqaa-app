/**
 * OA-07 — Audit Log
 *
 * Pixel-parity port of the OA-07 mockup.
 * Wired to GET /audit via `listAudit` from @/lib/audit.
 * Data: { items: AuditEntry[], total: number, offset?: number }
 *
 * Inert / disabled UI items (no backend source):
 *   - Stat strip numbers        → TODO(backend): no /audit-logs summary stats endpoint
 *   - Activity sparkline        → TODO(backend): no timeseries breakdown endpoint
 *   - Search input              → TODO(backend): free-text search not in /audit params
 *   - Date-range buttons        → TODO(backend): no date-range filter param in /audit
 *   - Action filter pill        → TODO(backend): action filter exists in /audit but no dropdown UI source
 *   - Actor filter pill         → TODO(backend): no actor filter param in /audit
 *   - Entity filter pill        → entity_type param exists; rendered inert for parity
 *   - Summary/Source columns    → TODO(backend): AuditEntry has no IP, user-agent, or summary fields
 *   - Export CSV button         → TODO(backend): no export endpoint
 *   - Live-stream button        → TODO(backend): no WebSocket endpoint
 *   - Pagination prev/first btn → wired to real page state
 */

import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { listAudit } from "@/lib/audit";
import type { AuditEntry } from "@/lib/audit";

import "./AuditPage.css";

// Audit-scoped t() wrapper — keys live under the `audit` namespace in the
// combined translation file, so we prefix all calls with "audit." and use
// the default `translation` namespace (i18n is flat, not multi-namespace).
function useAuditT() {
  const { t } = useTranslation();
  return {
    t: (key: string, options?: Record<string, unknown>) =>
      t(`audit.${key}`, options ?? {}),
  };
}

// ── Page size ────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

// ── Inline icon helper (mirrors DashboardPage pattern) ───────────────────
function Icon({
  children,
  className = "oa-icon oa-icon-sm",
  "aria-hidden": ariaHidden = true,
}: {
  children: ReactNode;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden={ariaHidden}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// ── Icon shapes ──────────────────────────────────────────────────────────
const ICONS = {
  fileLog: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M5 21v-1a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v1" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  chevronDouble: (
    <>
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </>
  ),
  chevronRight: <polyline points="15 18 9 12 15 6" />,
  chevronLeft: <polyline points="9 18 15 12 9 6" />,
  system: <rect x="3" y="3" width="18" height="18" rx="2" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  filter: (
    <>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </>
  ),
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  actionFilter: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  actorFilter: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M5 21v-1a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v1" />
    </>
  ),
  entityFilter: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
    </>
  ),
};

// ── Formatting helpers ────────────────────────────────────────────────────
function useFormatters() {
  const { i18n } = useTranslation(); // default translation namespace
  const lang = i18n.language;
  return {
    /** Full date+time for timestamp cell */
    datetime: (iso: string) =>
      new Date(iso).toLocaleString(lang, {
        dateStyle: "short",
        timeStyle: "medium",
      }),
    /** Time-only for secondary sub-row */
    timeOnly: (iso: string) =>
      new Date(iso).toLocaleTimeString(lang, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    /** Integer with thousands separator */
    int: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
  };
}

const PLACEHOLDER = "—";

// ── Action → chip style mapping ───────────────────────────────────────────
type ChipVariant =
  | "create"
  | "update"
  | "delete"
  | "read"
  | "auth"
  | "approve"
  | "reject"
  | "rule";

function resolveChipVariant(action: string): ChipVariant {
  const a = action.toLowerCase();
  if (a.includes("create") || a.includes("insert") || a.includes("add")) return "create";
  if (a.includes("delete") || a.includes("remove") || a.includes("destroy")) return "delete";
  if (a.includes("approve") || a.includes("confirm")) return "approve";
  if (a.includes("reject") || a.includes("deny") || a.includes("decline")) return "reject";
  if (
    a.includes("rule") ||
    a.includes("setting") ||
    a.includes("config") ||
    a.includes("business")
  )
    return "rule";
  if (
    a.includes("auth") ||
    a.includes("login") ||
    a.includes("logout") ||
    a.includes("session") ||
    a.includes("2fa")
  )
    return "auth";
  if (a.includes("read") || a.includes("view") || a.includes("export") || a.includes("list"))
    return "read";
  if (a.includes("update") || a.includes("edit") || a.includes("patch") || a.includes("change"))
    return "update";
  return "update";
}

function ChipIcon({ variant }: { variant: ChipVariant }) {
  switch (variant) {
    case "create":
      return <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
    case "update":
      return <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
    case "delete":
      return <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>;
    case "read":
      return <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
    case "auth":
      return <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
    case "approve":
      return <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>;
    case "reject":
      return <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
    case "rule":
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /></svg>;
    default:
      return null;
  }
}

// ── Actor avatar color palette (deterministic per user_id) ───────────────
const AVATAR_COLORS = [
  { bg: "var(--tranquil-200)", color: "var(--trust-700)" },
  { bg: "var(--purple-100)", color: "var(--purple-700)" },
  { bg: "var(--gold-100)", color: "var(--gold-700)" },
  { bg: "var(--success-50)", color: "var(--success-700)" },
  { bg: "var(--rose-100)", color: "var(--rose-700)" },
  { bg: "var(--teal-100)", color: "var(--teal-700)" },
];

function avatarStyle(userId: string | null) {
  if (!userId) return { backgroundColor: "var(--gray-900)", color: "white" };
  // stable hash → deterministic color
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  const entry = AVATAR_COLORS[idx] ?? AVATAR_COLORS[0]!;
  return {
    backgroundColor: entry.bg,
    color: entry.color,
  };
}

function actorInitials(email: string | null): string {
  if (!email) return "?";
  // "khaled.ali@ex.com" → "ك.ع" / "K.A"
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    const p0 = parts[0] ?? "";
    const p1 = parts[1] ?? "";
    return ((p0[0] ?? "") + "." + (p1[0] ?? "")).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

// ── Row severity ─────────────────────────────────────────────────────────
type Severity = "info" | "warn" | "danger" | "success";

function resolveSeverity(entry: AuditEntry): Severity {
  if (entry.is_sensitive) {
    const variant = resolveChipVariant(entry.action);
    if (variant === "delete") return "danger";
    return "warn";
  }
  const variant = resolveChipVariant(entry.action);
  if (variant === "approve") return "success";
  if (variant === "create") return "success";
  if (variant === "delete") return "danger";
  return "info";
}

function rowClass(sev: Severity): string {
  if (sev === "danger") return "row-danger";
  if (sev === "warn") return "row-warn";
  return "";
}

// ── Stat card sub-component ──────────────────────────────────────────────
function StatCard({
  icon,
  iconClass,
  label,
  value,
}: {
  icon: ReactNode;
  iconClass: string;
  label: string;
  value: string;
}) {
  return (
    <article className="oa-audit-stat" aria-label={`${label}: ${value}`}>
      <div className={`oa-audit-stat-icon${iconClass ? ` ${iconClass}` : ""}`} aria-hidden="true">
        {icon}
      </div>
      <div className="oa-audit-stat-text">
        <div className="lbl">{label}</div>
        <div className="val latin">{value}</div>
      </div>
    </article>
  );
}

// ── Sparkline placeholder columns (static visual, no real data) ──────────
// TODO(backend): no audit-timeseries endpoint exists — rendering a static
// decorative placeholder that matches the mockup layout.
const SPARK_SEED = [
  [4, 2, 3, 1],
  [3, 2, 1, 0],
  [2, 1, 2, 0],
  [2, 0, 1, 0],
  [1, 1, 0, 0],
  [0, 0, 0, 0],
  [1, 0, 1, 0],
  [2, 1, 1, 0],
  [3, 2, 2, 0],
  [5, 4, 3, 1],
  [7, 5, 4, 1],
  [8, 6, 5, 1],
  [9, 7, 6, 1],
  [10, 8, 7, 2],
  [11, 9, 8, 2],
  [10, 9, 7, 1],
  [9, 7, 6, 1],
  [8, 6, 5, 1],
  [6, 4, 3, 1],
  [7, 5, 3, 1],
  [8, 6, 4, 1],
  [9, 7, 4, 2],
  [10, 8, 5, 2],
  [12, 9, 6, 3],
];
const SPARK_MAX = 30;
const SPARK_TYPES: Array<"create" | "update" | "auth" | "delete"> = [
  "create",
  "update",
  "auth",
  "delete",
];

// ═══════════════════════════════════════════════════════════════════════
// Main page component
// ═══════════════════════════════════════════════════════════════════════
export function AuditPage() {
  const { t } = useAuditT();
  const fmt = useFormatters();

  // Pagination state — only page nav is wired; filter state is inert.
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", { offset }],
    queryFn: () => listAudit({ limit: PAGE_SIZE, offset }),
    placeholderData: (prev) => prev,
  });

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="oa-audit">
      {/* ── Single semantic h1 (screen-reader anchor) ── */}
      <h1 className="sr-only">{t("h1")}</h1>

      {/* ── Topbar-style header + action buttons ── */}
      <div className="oa-audit-topbar-actions">
        <div className="oa-audit-topbar-title">
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {/* TODO(backend): Export CSV — no export endpoint in /audit */}
          <button
            className="oa-audit-btn-secondary"
            disabled
            aria-label={t("export")}
            aria-disabled="true"
          >
            <svg viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("export")}
          </button>
          {/* TODO(backend): Live stream — no WebSocket / SSE endpoint */}
          <button
            className="oa-audit-btn-primary"
            disabled
            aria-label={t("liveStream")}
            aria-disabled="true"
          >
            <svg viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            {t("liveStream")}
          </button>
        </div>
      </div>

      {/* ══ Stat strip ══ */}
      {/* TODO(backend): stat counts (events24h, activeUsers, approvals,
          securityAlerts, failedAttempts) have no dedicated summary endpoint
          in /audit. Showing PLACEHOLDER "—" for all five. */}
      <section className="oa-audit-stats" aria-label={t("title")}>
        <StatCard
          icon={<Icon>{ICONS.fileLog}</Icon>}
          iconClass=""
          label={t("stats.events24h")}
          value={PLACEHOLDER}
        />
        <StatCard
          icon={<Icon>{ICONS.users}</Icon>}
          iconClass="purple"
          label={t("stats.activeUsers")}
          value={PLACEHOLDER}
        />
        <StatCard
          icon={<Icon>{ICONS.check}</Icon>}
          iconClass="green"
          label={t("stats.approvals")}
          value={PLACEHOLDER}
        />
        <StatCard
          icon={<Icon>{ICONS.alert}</Icon>}
          iconClass="warn"
          label={t("stats.securityAlerts")}
          value={PLACEHOLDER}
        />
        <StatCard
          icon={<Icon>{ICONS.ban}</Icon>}
          iconClass="danger"
          label={t("stats.failedAttempts")}
          value={PLACEHOLDER}
        />
      </section>

      {/* ══ Activity sparkline ══ */}
      {/* TODO(backend): no audit-timeseries endpoint — sparkline is a static
          decorative element only, aria-hidden so screen readers skip it. */}
      <section
        className="oa-audit-spark"
        aria-hidden="true"
        role="presentation"
      >
        <div className="oa-audit-spark-top">
          <div className="oa-audit-spark-title">
            <span className="num">{PLACEHOLDER}</span>
            <span className="unit">{t("stats.events24h")}</span>
          </div>
          <div className="oa-audit-spark-legend">
            <span>
              <span
                className="oa-audit-spark-legend-dot"
                style={{ background: "var(--success-500)" }}
              />
              {t("actions.create")}
            </span>
            <span>
              <span
                className="oa-audit-spark-legend-dot"
                style={{ background: "var(--info-500)" }}
              />
              {t("actions.update")}
            </span>
            <span>
              <span
                className="oa-audit-spark-legend-dot"
                style={{ background: "var(--purple-500)" }}
              />
              {t("actions.auth")}
            </span>
            <span>
              <span
                className="oa-audit-spark-legend-dot"
                style={{ background: "var(--danger-500)" }}
              />
              {t("actions.delete")}
            </span>
          </div>
        </div>
        <div className="oa-audit-spark-cols">
          {SPARK_SEED.map((counts, i) => (
            <div key={i} className="oa-audit-spark-col">
              {counts.map((c, k) =>
                c > 0 ? (
                  <div
                    key={k}
                    className={`oa-audit-spark-seg ${SPARK_TYPES[k]}`}
                    style={{ height: `${(c / SPARK_MAX) * 60}px` }}
                  />
                ) : null,
              )}
            </div>
          ))}
        </div>
        <div className="oa-audit-spark-axis">
          {["00:00", "06:00", "12:00", "18:00", "23:00"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </section>

      {/* ══ Filters bar ══ */}
      {/* TODO(backend): free-text search, date-range, actor filter, entity
          filter have no corresponding API params in the current /audit
          endpoint. All filter controls are rendered inert for UI parity. */}
      <section
        className="oa-audit-filters"
        aria-label={t("filters.rangeLabel")}
      >
        {/* Search box — inert, no free-text search param */}
        <label className="oa-audit-search" aria-label={t("filters.searchPlaceholder")}>
          <Icon>{ICONS.search}</Icon>
          <input
            type="search"
            placeholder={t("filters.searchPlaceholder")}
            aria-label={t("filters.searchPlaceholder")}
            disabled
            aria-disabled="true"
          />
        </label>

        {/* Date-range strip */}
        <div
          className="oa-audit-range-strip"
          role="group"
          aria-label={t("filters.rangeLabel")}
        >
          {/* All range buttons are inert — no date param in /audit */}
          {(
            [
              t("filters.lastHour"),
              t("filters.last24h"),
              t("filters.last7d"),
              t("filters.last30d"),
              t("filters.custom"),
            ] as const
          ).map((label, i) => (
            <button
              key={i}
              className={`oa-audit-range-btn${i === 1 ? " active" : ""}`}
              disabled
              aria-disabled="true"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Action filter pill — inert */}
        <button
          className="oa-audit-filter-pill"
          disabled
          aria-disabled="true"
          aria-label={t("filters.action")}
        >
          <svg className="oa-icon oa-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          {t("filters.action")}
          <svg className="oa-icon oa-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Actor filter pill — inert */}
        <button
          className="oa-audit-filter-pill"
          disabled
          aria-disabled="true"
          aria-label={t("filters.actor")}
        >
          <svg className="oa-icon oa-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="7" r="4" />
            <path d="M5 21v-1a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v1" />
          </svg>
          {t("filters.actor")}
          <svg className="oa-icon oa-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Entity filter pill — inert */}
        <button
          className="oa-audit-filter-pill"
          disabled
          aria-disabled="true"
          aria-label={t("filters.entity")}
        >
          <svg className="oa-icon oa-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="12" y1="8" x2="12" y2="16" />
          </svg>
          {t("filters.entity")}
          <svg className="oa-icon oa-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </section>

      {/* ══ Error bar ══ */}
      {error && (
        <div className="oa-audit-error-bar" role="alert">
          {t("error")}
        </div>
      )}

      {/* ══ Log table ══ */}
      <section
        className="oa-audit-tbl-wrap"
        aria-label={t("title")}
        aria-live="polite"
        aria-busy={isLoading}
      >
        <div className="oa-audit-tbl-scroll">
          <table className="oa-audit-table">
            <thead>
              <tr>
                <th className="th-sev" scope="col">
                  <span className="sr-only">{t("table.severity")}</span>
                </th>
                <th scope="col">{t("table.time")}</th>
                <th scope="col">{t("table.actor")}</th>
                <th scope="col">{t("table.action")}</th>
                <th scope="col">{t("table.entity")}</th>
                <th scope="col">{t("table.summary")}</th>
                {/* TODO(backend): AuditEntry has no IP / user-agent field */}
                <th scope="col">{t("table.source")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
                    <tr key={i} className="oa-audit-skeleton-row" aria-hidden="true">
                      <td><div className="oa-audit-skel" style={{ width: 6, height: 24 }} /></td>
                      <td><div className="oa-audit-skel" style={{ width: 80 }} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div className="oa-audit-skel" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                          <div className="oa-audit-skel" style={{ width: 100 }} />
                        </div>
                      </td>
                      <td><div className="oa-audit-skel" style={{ width: 70, height: 22, borderRadius: 9999 }} /></td>
                      <td><div className="oa-audit-skel" style={{ width: 140 }} /></td>
                      <td><div className="oa-audit-skel" style={{ width: 200 }} /></td>
                      <td><div className="oa-audit-skel" style={{ width: 90 }} /></td>
                    </tr>
                  ))
                : null}

              {!isLoading && items.length === 0 && !error && (
                <tr>
                  <td colSpan={7}>
                    <div className="oa-audit-state">
                      <Icon className="oa-icon">{ICONS.inbox}</Icon>
                      <div className="oa-audit-state-title">{t("empty")}</div>
                    </div>
                  </td>
                </tr>
              )}

              {items.map((entry) => {
                const sev = resolveSeverity(entry);
                const variant = resolveChipVariant(entry.action);
                const isSystem = !entry.user_id;

                return (
                  <tr
                    key={entry.id}
                    className={rowClass(sev)}
                    tabIndex={0}
                    aria-label={`${t("table.action")}: ${entry.action}, ${t("table.entity")}: ${entry.entity_type}`}
                  >
                    {/* Severity bar */}
                    <td style={{ padding: 0 }}>
                      <span
                        className={`oa-audit-sev ${sev}`}
                        aria-label={sev}
                      />
                    </td>

                    {/* Timestamp */}
                    <td>
                      <div className="oa-audit-time latin">
                        {fmt.timeOnly(entry.created_at)}
                      </div>
                      <div className="oa-audit-time-sub latin">
                        {fmt.datetime(entry.created_at)}
                      </div>
                    </td>

                    {/* Actor */}
                    <td>
                      <div className="oa-audit-actor">
                        {isSystem ? (
                          <div
                            className="oa-audit-avatar system"
                            aria-label={t("actor.system")}
                          >
                            <svg
                              style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <path d="M9 9h6v6H9z" />
                            </svg>
                          </div>
                        ) : (
                          <div
                            className="oa-audit-avatar"
                            style={avatarStyle(entry.user_id)}
                            aria-hidden="true"
                          >
                            {actorInitials(entry.user_id)}
                          </div>
                        )}
                        <div className="oa-audit-actor-info">
                          <div className="oa-audit-actor-name">
                            {isSystem ? t("actor.system") : (entry.user_id ?? t("actor.unknown"))}
                          </div>
                          {/* actor_email not in AuditEntry; user_id shown as secondary */}
                          <div className="oa-audit-actor-role mono" style={{ fontSize: 10 }}>
                            {entry.user_id ? (
                              <span className="latin">{entry.user_id.slice(0, 12)}</span>
                            ) : (
                              PLACEHOLDER
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Action chip */}
                    <td>
                      <span className={`oa-audit-chip ${variant}`}>
                        <ChipIcon variant={variant} />
                        {t(`actions.${variant}`, { defaultValue: entry.action })}
                      </span>
                    </td>

                    {/* Entity */}
                    <td>
                      <div className="oa-audit-entity">
                        <span className="oa-audit-entity-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </span>
                        <div className="oa-audit-entity-text">
                          <div className="oa-audit-entity-name">
                            {entry.entity_type || PLACEHOLDER}
                          </div>
                          {entry.entity_id ? (
                            <div className="oa-audit-entity-id">
                              <span className="badge latin">
                                {entry.entity_id.slice(0, 16)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Summary — derived from new_values / old_values diff keys
                        TODO(backend): AuditEntry has no dedicated summary field;
                        showing changed key names from new_values/old_values. */}
                    <td>
                      <div className="oa-audit-summary">
                        {summarizeValues(entry)}
                      </div>
                    </td>

                    {/* Source — TODO(backend): AuditEntry has no IP / user-agent field */}
                    <td>
                      <div className="oa-audit-source latin">{PLACEHOLDER}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer ── */}
        <div className="oa-audit-tbl-foot">
          <span className="oa-audit-pg-info">
            {total > 0
              ? t("pagination.showing", {
                  from: fmt.int(from),
                  to: fmt.int(to),
                  total: fmt.int(total),
                })
              : null}
          </span>
          <div className="oa-audit-pg-controls" role="navigation" aria-label={t("title")}>
            {/* First page */}
            <button
              className="oa-audit-pg-btn"
              onClick={() => setPage(0)}
              disabled={page === 0}
              aria-label={t("pagination.first")}
            >
              <svg viewBox="0 0 24 24">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
            {/* Prev */}
            <button
              className="oa-audit-pg-btn"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label={t("pagination.prev")}
            >
              <svg viewBox="0 0 24 24">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            {/* Page number pills — show current ± 1, first, last */}
            {pageNumbers(page, pageCount).map((p, i) =>
              p === null ? (
                <span key={`ellipsis-${i}`} style={{ color: "var(--gray-400)", padding: "0 4px" }}>
                  …
                </span>
              ) : (
                <button
                  key={p}
                  className={`oa-audit-pg-btn${p === page ? " active" : ""}`}
                  onClick={() => setPage(p)}
                  aria-current={p === page ? "page" : undefined}
                  aria-label={String(p + 1)}
                >
                  <span className="latin">{fmt.int(p + 1)}</span>
                </button>
              ),
            )}

            {/* Next */}
            <button
              className="oa-audit-pg-btn"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              aria-label={t("pagination.next")}
            >
              <svg viewBox="0 0 24 24">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Produces a short human-readable diff summary from new_values / old_values.
 * Returns "—" when neither is present.
 * TODO(backend): AuditEntry has no dedicated summary or IP fields; this is a
 * best-effort derivation from old_values/new_values diff keys. */
function summarizeValues(entry: AuditEntry): string {
  const newer = entry.new_values;
  const older = entry.old_values;
  if (!newer && !older) return "—";
  const changed: string[] = [];
  if (newer && older) {
    for (const key of Object.keys(newer)) {
      if (JSON.stringify(newer[key]) !== JSON.stringify(older[key])) {
        changed.push(key);
      }
    }
  } else if (newer) {
    Object.keys(newer).slice(0, 3).forEach((k) => changed.push(k));
  } else if (older) {
    Object.keys(older).slice(0, 3).forEach((k) => changed.push(k));
  }
  if (changed.length === 0) return "—";
  return changed.slice(0, 3).join(", ");
}

/** Returns an array of page indices (0-based) with nulls for ellipsis gaps.
 * Shows: first, …, prev, current, next, …, last (within reason). */
function pageNumbers(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const pages: Array<number | null> = [];
  const add = (p: number) => {
    if (!pages.includes(p)) pages.push(p);
  };
  add(0);
  if (current > 2) pages.push(null);
  for (let i = Math.max(1, current - 1); i <= Math.min(total - 2, current + 1); i++) add(i);
  if (current < total - 3) pages.push(null);
  add(total - 1);
  return pages;
}

