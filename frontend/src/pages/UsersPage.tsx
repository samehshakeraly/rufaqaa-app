/**
 * OA-02 Users Management
 * Ported 1:1 from /tmp/mockup-oa02.html.
 * Layout: stat strip → filter bar → bulk bar → table → pagination.
 * Invite modal opens from the "Invite User" button.
 * All data wiring preserved from the original UsersPage.tsx.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { listPartners, type Partner } from "@/lib/partners";
import {
  inviteUser,
  listUsers,
  reactivateUser,
  suspendUser,
  updateUser,
  type AdminUser,
  type UserInviteResult,
} from "@/lib/users";
import { toast } from "@/store/toasts";

import "./UsersPage.css";

// ── Inline icon helper ──────────────────────────────────────────
function Icon({
  children,
  className = "oa-icon oa-icon-sm",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

// ── Icon path definitions ───────────────────────────────────────
const ICONS = {
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  envelope: (
    <>
      <path d="M4 4h16v16H4z" />
      <polyline points="4 4 12 13 20 4" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  filter: (
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </>
  ),
  status: (
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  ),
  building: (
    <>
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
    </>
  ),
  sortUp: <polyline points="6 15 12 9 18 15" />,
  sortDown: <polyline points="6 9 12 15 18 9" />,
  chevronLeft: <polyline points="15 18 9 12 15 6" />,
  chevronRight: <polyline points="9 18 15 12 9 6" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  userPlus: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
    </>
  ),
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  edit: (
    <>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),
  userCheck: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M5 6V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>
  ),
  warn: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
};

// ── Constants ───────────────────────────────────────────────────
const PAGE_SIZE_DEFAULT = 12;
const PAGE_SIZES = [12, 24, 50];

// Roles the org-admin API actually filters on.
const ROLE_OPTIONS = [
  "",
  "super_admin",
  "org_admin",
  "partner_manager",
  "partner_staff",
  "marketing_manager",
  "finance",
  "donor",
  "guardian",
  "viewer",
] as const;

// Roles an org admin may invite (subset).
const INVITABLE_ROLES = [
  "org_admin",
  "case_manager",
  "finance_officer",
  "viewer",
] as const;

type InvitableRole = (typeof INVITABLE_ROLES)[number];

function isAllowedRoleFilter(v: string): boolean {
  return (ROLE_OPTIONS as readonly string[]).includes(v);
}

// ── Avatar colour cycle (hash by id) ───────────────────────────
function avatarColor(id: string): string {
  const colours = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return colours[h % colours.length] ?? "c1";
}

// ── Initials from name ──────────────────────────────────────────
function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

// ── Status → chip class ─────────────────────────────────────────
function statusChipClass(status: string): string {
  switch (status) {
    case "active":    return "active";
    case "invited":   return "invited";
    case "suspended":
    case "disabled":  return "disabled";
    case "locked":    return "locked";
    default:          return "disabled";
  }
}

// ── Role → chip class ───────────────────────────────────────────
function roleChipClass(role: string): string {
  if (role.includes("admin") || role.includes("super")) return "r-admin";
  if (role.includes("finance")) return "r-finance";
  if (role.includes("viewer") || role.includes("guardian")) return "r-viewer";
  return "r-case";
}

// ── Role → icon ─────────────────────────────────────────────────
function roleIcon(role: string): ReactNode {
  if (role.includes("admin") || role.includes("super")) return ICONS.shield;
  if (role.includes("finance")) return ICONS.dollar;
  if (role.includes("viewer")) return ICONS.eye;
  return ICONS.userCheck;
}

// ── Date/time formatter ─────────────────────────────────────────
function useFormatters() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    datetime: (ts: string) =>
      new Date(ts).toLocaleString(lang, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    int: (n: number) =>
      n.toLocaleString(lang, { maximumFractionDigits: 0 }),
  };
}

const PLACEHOLDER = "—";

// ════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════
export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const fmt = useFormatters();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawUrlRole = searchParams.get("role") ?? "";
  const urlRole = isAllowedRoleFilter(rawUrlRole) ? rawUrlRole : "";

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [role, setRole] = useState<string>(urlRole);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Sync URL ?role= → local state
  useEffect(() => { setRole(urlRole); }, [urlRole]);
  // Reset page on filter change
  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [role, search]);

  function onRoleChange(next: string) {
    setRole(next);
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("role", next);
    else sp.delete("role");
    setSearchParams(sp, { replace: true });
  }

  const offset = (page - 1) * pageSize;
  // TODO(backend): search by name/email not yet wired — listUsers has no
  // `search` param in its type. The input is rendered and local state is
  // maintained ready for when the backend endpoint supports ?search=.
  const { data, isLoading, error } = useQuery({
    queryKey: ["users", { limit: pageSize, offset, role }],
    queryFn: () =>
      listUsers({ limit: pageSize, offset, ...(role ? { role } : {}) }),
  });

  // Partner organizations (جهة) — same data source PartnersPage uses, so the
  // cache is shared. Drives the row label + the form selectors.
  const { data: partnersData } = useQuery({
    queryKey: ["partners", { includeInactive: true }],
    queryFn: () => listPartners(true),
  });
  const partners: Partner[] = useMemo(() => partnersData?.items ?? [], [partnersData]);
  const partnerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of partners) m.set(p.id, p.name_ar);
    return m;
  }, [partners]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"], exact: false });

  const suspend = useMutation({
    mutationFn: (id: string) => suspendUser(id),
    onSuccess: async () => { await invalidate(); toast.success(t("users.suspended")); },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: async () => { await invalidate(); toast.success(t("users.reactivated")); },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  const users: AdminUser[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Selection helpers
  const allSelected = users.length > 0 && users.every((u) => selectedIds.has(u.id));
  const someSelected = users.some((u) => selectedIds.has(u.id));
  const selectedCount = users.filter((u) => selectedIds.has(u.id)).length;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        users.forEach((u) => next.delete(u.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        users.forEach((u) => next.add(u.id));
        return next;
      });
    }
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }

  // Close open menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    function handle() { setOpenMenuId(null); }
    document.addEventListener("click", handle);
    return () => document.removeEventListener("click", handle);
  }, [openMenuId]);

  // Close modal / clear selection on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showInvite) setShowInvite(false);
        if (editUser) setEditUser(null);
        setOpenMenuId(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showInvite, editUser]);

  // ── Stat strip counts  ──────────────────────────────────────
  // TODO(backend): /org/users returns `total` but no breakdown by status
  // or 2FA state. All sub-counts (active, invited, 2FA-enabled, last-login)
  // are shown as "—" pending a dedicated /org/users/stats endpoint.
  const statTotal = total;

  return (
    <div className="oa-users">
      {/* Single semantic h1 — screen-reader page anchor */}
      <h1 className="sr-only">{t("users.title")}</h1>

      {/* ── Page header (visible) ─────────────────────────────── */}
      <div className="oa-users-page-head">
        <div className="oa-users-page-head-text">
          <h2>{t("users.title")}</h2>
          <p>{t("users.subtitle")}</p>
        </div>
        <div className="oa-users-head-actions">
          {/* TODO(backend): CSV export not implemented; button is decorative placeholder */}
          <button className="oa-btn-secondary" type="button" aria-label={t("users.exportCsv")}>
            <Icon>{ICONS.download}</Icon>
            {t("users.exportCsv")}
          </button>
          <button
            className="oa-btn-primary"
            type="button"
            onClick={() => setShowInvite(true)}
          >
            <Icon>{ICONS.userPlus}</Icon>
            {t("users.inviteUser")}
          </button>
        </div>
      </div>

      {/* ── Stat strip ────────────────────────────────────────── */}
      <section className="oa-users-stat-strip" aria-label={t("users.usersSummary")}>
        {/* Total users — sourced from /org/users total */}
        <div className="oa-users-stat">
          <div className="oa-users-stat-icon">
            <Icon>{ICONS.users}</Icon>
          </div>
          <div>
            <div className="oa-users-stat-lbl">{t("users.stats.total")}</div>
            <div className="oa-users-stat-val">
              <span className="latin">{fmt.int(statTotal)}</span>
            </div>
          </div>
        </div>
        {/* Active users — TODO(backend): no status breakdown in /org/users */}
        <div className="oa-users-stat">
          <div className="oa-users-stat-icon green">
            <Icon>{ICONS.check}</Icon>
          </div>
          <div>
            <div className="oa-users-stat-lbl">{t("users.stats.active")}</div>
            <div className="oa-users-stat-val">{PLACEHOLDER}</div>
          </div>
        </div>
        {/* Pending invitations — TODO(backend): no invitation count in /org/users */}
        <div className="oa-users-stat">
          <div className="oa-users-stat-icon gold">
            <Icon>{ICONS.envelope}</Icon>
          </div>
          <div>
            <div className="oa-users-stat-lbl">{t("users.stats.pendingInvitations")}</div>
            <div className="oa-users-stat-val">{PLACEHOLDER}</div>
          </div>
        </div>
        {/* 2FA enabled count — TODO(backend): no 2FA summary in /org/users */}
        <div className="oa-users-stat">
          <div className="oa-users-stat-icon warn">
            <Icon>{ICONS.lock}</Icon>
          </div>
          <div>
            <div className="oa-users-stat-lbl">{t("users.stats.twoFactor")}</div>
            <div className="oa-users-stat-val">
              {PLACEHOLDER} <span className="unit">{t("users.stats.twoFactorEnabled")}</span>
            </div>
          </div>
        </div>
        {/* Last login — TODO(backend): no aggregate last-login in /org/users */}
        <div className="oa-users-stat">
          <div className="oa-users-stat-icon purple">
            <Icon>{ICONS.clock}</Icon>
          </div>
          <div>
            <div className="oa-users-stat-lbl">{t("users.stats.lastLogin")}</div>
            <div className="oa-users-stat-val">{PLACEHOLDER}</div>
          </div>
        </div>
      </section>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <section className="oa-users-filter-bar" aria-label="Filters">
        {/* Search */}
        <label className="oa-users-search">
          <Icon>{ICONS.search}</Icon>
          <input
            type="search"
            placeholder={t("users.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("users.searchPlaceholder")}
          />
        </label>

        {/* Role tabs */}
        <div className="oa-users-role-tabs" role="tablist">
          <button
            className={`oa-users-role-tab${role === "" ? " active" : ""}`}
            role="tab"
            aria-selected={role === ""}
            type="button"
            onClick={() => onRoleChange("")}
          >
            {t("users.allRoles")}
            <span className="count latin">{fmt.int(total)}</span>
          </button>
          <button
            className={`oa-users-role-tab${role === "org_admin" ? " active" : ""}`}
            role="tab"
            aria-selected={role === "org_admin"}
            type="button"
            onClick={() => onRoleChange("org_admin")}
          >
            {t("users.roles.org_admin")}
          </button>
          <button
            className={`oa-users-role-tab${role === "finance" || role === "finance_officer" ? " active" : ""}`}
            role="tab"
            aria-selected={role === "finance" || role === "finance_officer"}
            type="button"
            onClick={() => onRoleChange("finance")}
          >
            {t("users.roles.finance")}
          </button>
          <button
            className={`oa-users-role-tab${role === "marketing_manager" ? " active" : ""}`}
            role="tab"
            aria-selected={role === "marketing_manager"}
            type="button"
            onClick={() => onRoleChange("marketing_manager")}
          >
            {t("users.roles.marketing_manager")}
          </button>
          <button
            className={`oa-users-role-tab${role === "partner_manager" ? " active" : ""}`}
            role="tab"
            aria-selected={role === "partner_manager"}
            type="button"
            onClick={() => onRoleChange("partner_manager")}
          >
            {t("users.roles.partner_manager")}
          </button>
          <button
            className={`oa-users-role-tab${role === "partner_staff" ? " active" : ""}`}
            role="tab"
            aria-selected={role === "partner_staff"}
            type="button"
            onClick={() => onRoleChange("partner_staff")}
          >
            {t("users.roles.partner_staff")}
          </button>
          <button
            className={`oa-users-role-tab${role === "viewer" ? " active" : ""}`}
            role="tab"
            aria-selected={role === "viewer"}
            type="button"
            onClick={() => onRoleChange("viewer")}
          >
            {t("users.roles.viewer")}
          </button>
        </div>

        {/* Status filter — TODO(backend): filter by status not yet in API */}
        <button className="oa-users-filter-pill" type="button" aria-label={t("users.allStatuses")}>
          <Icon>{ICONS.status}</Icon>
          {t("users.allStatuses")}
          <Icon>{ICONS.sortDown}</Icon>
        </button>

        {/* Advanced filters */}
        <button
          className="oa-users-icon-btn"
          type="button"
          aria-label={t("users.advancedFilters")}
          title={t("users.moreFilters")}
        >
          <Icon className="oa-icon oa-icon-md">{ICONS.filter}</Icon>
        </button>
      </section>

      {/* ── Bulk action bar ───────────────────────────────────── */}
      <div className={`oa-users-bulk-bar${selectedCount > 0 ? " show" : ""}`} aria-live="polite">
        <div className="oa-users-bulk-start">
          <span className="oa-users-bulk-count-pill">
            <span className="latin">{selectedCount}</span> {t("users.bulk.selected")}
          </span>
          <span style={{ opacity: 0.85 }}></span>
        </div>
        <div className="oa-users-bulk-actions">
          {/* TODO(backend): bulk role-change not yet implemented */}
          <button className="oa-users-bulk-btn" type="button">
            <Icon>{ICONS.userCheck}</Icon>
            {t("users.bulk.changeRole")}
          </button>
          {/* TODO(backend): bulk disable not yet implemented */}
          <button className="oa-users-bulk-btn" type="button">
            <Icon>{ICONS.ban}</Icon>
            {t("users.bulk.disable")}
          </button>
          {/* TODO(backend): bulk resend-invite not yet implemented */}
          <button className="oa-users-bulk-btn" type="button">
            <Icon>{ICONS.envelope}</Icon>
            {t("users.bulk.resendInvite")}
          </button>
          <button className="oa-users-bulk-btn clear" type="button" onClick={clearSelection}>
            <Icon>{ICONS.close}</Icon>
            {t("users.bulk.clearSelection")}
          </button>
        </div>
      </div>

      {/* ── Table card ────────────────────────────────────────── */}
      <div className="oa-users-table-card">
        <div className="oa-users-table-wrap">
          {isLoading && (
            <div className="oa-users-loading">{t("common.loading")}</div>
          )}
          {error && (
            <div className="oa-users-error">{t("common.loadError")}</div>
          )}
          {!isLoading && !error && users.length === 0 && (
            <div className="oa-users-empty">
              <Icon className="oa-icon">{ICONS.users}</Icon>
              <div className="oa-users-empty-title">{t("users.empty")}</div>
            </div>
          )}
          {!isLoading && !error && users.length > 0 && (
            <table className="oa-users-table" aria-label={t("users.usersTable")}>
              <thead>
                <tr>
                  <th className="oa-users-col-chk">
                    <button
                      type="button"
                      className={`oa-users-check${allSelected ? " on" : someSelected ? " indeterminate" : ""}`}
                      aria-label={t("common.selectAll", "Select all")}
                      onClick={toggleAll}
                    />
                  </th>
                  <th className="sorted">
                    {t("users.cols.user")}
                    <Icon>{ICONS.sortUp}</Icon>
                  </th>
                  <th>{t("users.cols.rolePerms")}</th>
                  <th>{t("users.cols.status")}</th>
                  <th>{t("users.cols.twoFactor")}</th>
                  <th>
                    {t("users.cols.lastActivity")}
                    <Icon>{ICONS.sortDown}</Icon>
                  </th>
                  <th className="oa-users-col-actions">
                    <span className="sr-only">{t("users.cols.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = me?.id === u.id;
                  const isSelected = selectedIds.has(u.id);
                  const isInactive = u.status === "suspended" || u.status === "disabled";
                  const isInvited = u.status === "invited";
                  const menuOpen = openMenuId === u.id;

                  return (
                    <tr
                      key={u.id}
                      className={[
                        isSelected ? "selected" : "",
                        isInactive ? "inactive" : "",
                        isInvited ? "invited" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {/* Checkbox */}
                      <td className="oa-users-col-chk">
                        <button
                          type="button"
                          className={`oa-users-check${isSelected ? " on" : ""}`}
                          aria-label={`${t("common.select", "Select")} ${u.first_name} ${u.last_name}`}
                          onClick={() => toggleOne(u.id)}
                        />
                      </td>

                      {/* User cell */}
                      <td>
                        <div className="oa-users-cell">
                          {isInvited ? (
                            <div
                              className="oa-users-avatar invited-avatar"
                              aria-hidden="true"
                            >
                              <Icon>{ICONS.envelope}</Icon>
                            </div>
                          ) : (
                            <div
                              className={`oa-users-avatar ${avatarColor(u.id)}`}
                              aria-hidden="true"
                            >
                              {initials(u.first_name, u.last_name)}
                            </div>
                          )}
                          <div className="oa-users-info">
                            <div className="nm">
                              <span className={isInactive ? "oa-users-name-inactive" : ""}>
                                {u.first_name} {u.last_name}
                              </span>
                              {isSelf && (
                                <span className="oa-users-you-label">
                                  {" "}{t("users.youLabel")}
                                </span>
                              )}
                            </div>
                            <div className="em">{u.email}</div>
                            {u.partner_organization_id && (
                              <div className="partner-org">
                                <Icon>{ICONS.building}</Icon>
                                {partnerNameById.get(u.partner_organization_id) ?? PLACEHOLDER}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td>
                        <span className={`oa-users-role-chip ${roleChipClass(u.role)}`}>
                          <Icon>{roleIcon(u.role)}</Icon>
                          {t(`users.roles.${u.role}`, u.role)}
                        </span>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`oa-users-status-chip ${statusChipClass(u.status)}`}>
                          {t(`users.status.${u.status}`, u.status)}
                        </span>
                      </td>

                      {/* 2FA */}
                      <td>
                        {u.two_factor_enabled ? (
                          <span className="oa-users-2fa-chip enabled">
                            <Icon>{ICONS.lock}</Icon>
                            {t("users.twofa.enabled")}
                          </span>
                        ) : (
                          <span className="oa-users-2fa-chip disabled">
                            {t("users.twofa.notEnabled")}
                          </span>
                        )}
                      </td>

                      {/* Last activity */}
                      <td>
                        <div className="oa-users-last-seen">
                          {u.last_login_at
                            ? fmt.datetime(u.last_login_at)
                            : PLACEHOLDER}
                          {/* TODO(backend): no IP / location data returned by /org/users */}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="oa-users-col-actions">
                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            className={`oa-users-kebab${menuOpen ? " open" : ""}`}
                            disabled={isSelf}
                            aria-label={
                              isSelf
                                ? t("users.noSelfEdit")
                                : `${t("users.cols.actions")} — ${u.first_name} ${u.last_name}`
                            }
                            title={isSelf ? t("users.noSelfEdit") : undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(menuOpen ? null : u.id);
                            }}
                          >
                            <Icon className="oa-icon oa-icon-md">{ICONS.dots}</Icon>
                          </button>

                          {menuOpen && (
                            <div
                              className="oa-users-menu"
                              role="menu"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="oa-users-menu-item"
                                type="button"
                                role="menuitem"
                                onClick={() => { setEditUser(u); setOpenMenuId(null); }}
                              >
                                <Icon>{ICONS.edit}</Icon>
                                {t("users.actions.editProfile")}
                              </button>
                              {/* TODO(backend): change role not yet implemented */}
                              <button className="oa-users-menu-item" type="button" role="menuitem">
                                <Icon>{ICONS.userCheck}</Icon>
                                {t("users.actions.changeRole")}
                              </button>
                              {/* TODO(backend): reset password not yet implemented */}
                              <button className="oa-users-menu-item" type="button" role="menuitem">
                                <Icon>{ICONS.lock}</Icon>
                                {t("users.actions.resetPassword")}
                              </button>
                              {/* TODO(backend): activity log not yet implemented */}
                              <button className="oa-users-menu-item" type="button" role="menuitem">
                                <Icon>{ICONS.clock}</Icon>
                                {t("users.actions.viewActivity")}
                              </button>
                              <div className="oa-users-menu-sep" />
                              {/* TODO(backend): send notification not yet implemented */}
                              <button className="oa-users-menu-item" type="button" role="menuitem">
                                <Icon>{ICONS.bell}</Icon>
                                {t("users.actions.sendNotification")}
                              </button>
                              {u.status === "active" && (
                                <button
                                  className="oa-users-menu-item danger"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => { suspend.mutate(u.id); setOpenMenuId(null); }}
                                  disabled={suspend.isPending}
                                >
                                  <Icon>{ICONS.ban}</Icon>
                                  {t("users.actions.disable")}
                                </button>
                              )}
                              {(u.status === "suspended" || u.status === "disabled") && (
                                <button
                                  className="oa-users-menu-item"
                                  type="button"
                                  role="menuitem"
                                  onClick={() => { reactivate.mutate(u.id); setOpenMenuId(null); }}
                                  disabled={reactivate.isPending}
                                >
                                  <Icon>{ICONS.check}</Icon>
                                  {t("users.reactivate")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination footer ───────────────────────────────── */}
        {!isLoading && !error && users.length > 0 && (
          <div className="oa-users-table-foot">
            {/* Page info */}
            <div className="oa-users-pg-info">
              {t("users.pagination.showing")}{" "}
              <span className="latin">
                {fmt.int(offset + 1)}–{fmt.int(Math.min(offset + pageSize, total))}
              </span>{" "}
              {t("users.pagination.of")}{" "}
              <span className="latin">{fmt.int(total)}</span>{" "}
              {t("users.pagination.users")}
            </div>

            {/* Page buttons */}
            <div className="oa-users-pg-controls" role="navigation" aria-label={t("common.pagination", "Pagination")}>
              <button
                className="oa-users-pg-btn"
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label={t("common.previous")}
              >
                <Icon>{ICONS.chevronRight}</Icon>
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`oa-users-pg-btn${page === p ? " active" : ""}`}
                  onClick={() => setPage(p)}
                  aria-current={page === p ? "page" : undefined}
                >
                  <span className="latin">{p}</span>
                </button>
              ))}
              <button
                className="oa-users-pg-btn"
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                aria-label={t("common.next")}
              >
                <Icon>{ICONS.chevronLeft}</Icon>
              </button>
            </div>

            {/* Rows per page */}
            <div className="oa-users-pg-size">
              {t("users.pagination.rowsPerPage")}
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                aria-label={t("users.pagination.rowsPerPage")}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* ── Invite modal ──────────────────────────────────────── */}
      {showInvite && (
        <InviteModal
          me={me}
          partners={partners}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            await invalidate();
            setShowInvite(false);
          }}
        />
      )}

      {/* ── Edit user modal ───────────────────────────────────── */}
      {editUser && (
        <EditUserModal
          user={editUser}
          partners={partners}
          onClose={() => setEditUser(null)}
          onSaved={async () => {
            await invalidate();
            setEditUser(null);
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Invite modal
// ════════════════════════════════════════════════════════════════
interface InviteModalProps {
  me: { first_name?: string } | undefined;
  partners: Partner[];
  onClose: () => void;
  onInvited: (result: UserInviteResult) => void | Promise<void>;
}

const INVITE_DAYS = 7; // hardcoded per mockup

function InviteModal({ me, partners, onClose, onInvited }: InviteModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>(INVITABLE_ROLES[0]);
  const [partnerOrgId, setPartnerOrgId] = useState("");
  const [require2fa, setRequire2fa] = useState(true);
  const [sendWelcome, setSendWelcome] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus first input when modal opens
  useEffect(() => { firstInputRef.current?.focus(); }, []);

  const mut = useMutation({
    mutationFn: () =>
      inviteUser({
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: inviteRole,
        partner_organization_id: partnerOrgId || null,
      }),
    onSuccess: async (result) => {
      setServerError(null);
      toast.success(t("users.staff.invitePartnerStaff") + ": " + result.user.email);
      await onInvited(result);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      setServerError(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  // Role cards definition
  type RoleCard = { key: InvitableRole; icon: ReactNode; nameKey: string; descKey: string };
  const roleCards: RoleCard[] = [
    { key: "org_admin",      icon: ICONS.shield,   nameKey: "invite.roleCards.org_admin",      descKey: "invite.roleCards.org_adminDesc" },
    { key: "finance_officer",icon: ICONS.dollar,   nameKey: "invite.roleCards.finance",         descKey: "invite.roleCards.financeDesc" },
    { key: "case_manager",   icon: ICONS.userCheck, nameKey: "invite.roleCards.partner_staff",  descKey: "invite.roleCards.partner_staffDesc" },
    { key: "viewer",         icon: ICONS.eye,      nameKey: "invite.roleCards.viewer",          descKey: "invite.roleCards.viewerDesc" },
  ];

  return (
    <div
      className="oa-users-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oa-invite-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="oa-users-modal">
        {/* Modal header */}
        <div className="oa-users-modal-head">
          <div>
            <h2 id="oa-invite-title">
              <Icon className="oa-icon oa-icon-md">{ICONS.userPlus}</Icon>
              {t("users.invite.title")}
            </h2>
            <p>
              {t("users.invite.subtitle", { days: INVITE_DAYS })}
            </p>
          </div>
          <button
            type="button"
            className="oa-users-modal-close"
            aria-label={t("common.cancel")}
            onClick={onClose}
          >
            <Icon className="oa-icon oa-icon-md">{ICONS.close}</Icon>
          </button>
        </div>

        {/* Modal body */}
        <div className="oa-users-modal-body">
          <form
            id="oa-invite-form"
            onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
          >
            {/* Email */}
            <div className="oa-users-form-group">
              <label className="oa-users-form-label" htmlFor="oa-invite-email">
                {t("users.invite.emailLabel")}
              </label>
              <input
                ref={firstInputRef}
                id="oa-invite-email"
                type="email"
                required
                dir="ltr"
                className="oa-users-form-input latin"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="oa-users-form-help">{t("users.invite.emailHelp")}</div>
            </div>

            {/* Full name (optional) */}
            <div className="oa-users-form-group">
              <label className="oa-users-form-label" htmlFor="oa-invite-name">
                {t("users.invite.fullNameLabel")}{" "}
                <span className="opt">{t("users.invite.fullNameOptional")}</span>
              </label>
              <input
                id="oa-invite-name"
                type="text"
                className="oa-users-form-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>

            {/* Role grid */}
            <div className="oa-users-form-group">
              <div className="oa-users-form-label">{t("users.invite.roleLabel")}</div>
              <div className="oa-users-role-grid" role="radiogroup" aria-label={t("users.invite.roleLabel")}>
                {roleCards.map((rc) => (
                  <button
                    key={rc.key}
                    type="button"
                    className={`oa-users-role-card${inviteRole === rc.key ? " selected" : ""}`}
                    role="radio"
                    aria-checked={inviteRole === rc.key}
                    onClick={() => setInviteRole(rc.key)}
                  >
                    <div className="oa-users-role-card-mark">
                      <Icon>{rc.icon}</Icon>
                    </div>
                    <div className="oa-users-role-card-text">
                      <div className="nm">{t(`users.${rc.nameKey}`)}</div>
                      <div className="ds">{t(`users.${rc.descKey}`)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Partner organization (جهة) — optional */}
            <PartnerOrgSelect
              id="oa-invite-partner-org"
              partners={partners}
              value={partnerOrgId}
              onChange={setPartnerOrgId}
            />

            {/* Settings toggles */}
            <div className="oa-users-form-group">
              <div className="oa-users-form-label">{t("users.invite.settingsLabel")}</div>
              <div className="oa-users-toggle-row">
                <div>
                  <div className="ttl">{t("users.invite.require2fa")}</div>
                  <div className="sub">{t("users.invite.require2faHelp")}</div>
                </div>
                <button
                  type="button"
                  className={`oa-users-toggle${require2fa ? " on" : ""}`}
                  role="switch"
                  aria-checked={require2fa}
                  onClick={() => setRequire2fa((v) => !v)}
                />
              </div>
              <div className="oa-users-toggle-row">
                <div>
                  <div className="ttl">{t("users.invite.sendWelcome")}</div>
                  <div className="sub">{t("users.invite.sendWelcomeHelp", { name: me?.first_name ?? "" })}</div>
                </div>
                <button
                  type="button"
                  className={`oa-users-toggle${sendWelcome ? " on" : ""}`}
                  role="switch"
                  aria-checked={sendWelcome}
                  onClick={() => setSendWelcome((v) => !v)}
                />
              </div>
            </div>

            {/* Server error */}
            {serverError && (
              <div className="oa-users-error" role="alert">{serverError}</div>
            )}
          </form>
        </div>

        {/* Modal footer */}
        <div className="oa-users-modal-foot">
          <span className="oa-users-modal-foot-note">
            <Icon>{ICONS.info}</Icon>
            {t("users.invite.permissionsNote")}
          </span>
          <div className="oa-users-modal-foot-actions">
            <button
              type="button"
              className="oa-btn-secondary"
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="oa-invite-form"
              className="oa-btn-primary"
              disabled={mut.isPending}
            >
              <Icon>{ICONS.envelope}</Icon>
              {mut.isPending ? t("common.saving") : t("users.invite.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Partner organization (جهة) selector — shared by invite + edit forms
// ════════════════════════════════════════════════════════════════
interface PartnerOrgSelectProps {
  id: string;
  partners: Partner[];
  value: string;
  onChange: (value: string) => void;
}

function PartnerOrgSelect({ id, partners, value, onChange }: PartnerOrgSelectProps) {
  const { t } = useTranslation();
  return (
    <div className="oa-users-form-group">
      <label className="oa-users-form-label" htmlFor={id}>
        {t("users.invite.partnerOrgLabel")}{" "}
        <span className="opt">{t("users.invite.fullNameOptional")}</span>
      </label>
      <select
        id={id}
        className="oa-users-form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("users.invite.partnerOrgNone")}</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name_ar}
          </option>
        ))}
      </select>
      <div className="oa-users-form-help">{t("users.invite.partnerOrgHelp")}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Edit user modal — partner organization (جهة) assignment
// ════════════════════════════════════════════════════════════════
interface EditUserModalProps {
  user: AdminUser;
  partners: Partner[];
  onClose: () => void;
  onSaved: (result: AdminUser) => void | Promise<void>;
}

function EditUserModal({ user, partners, onClose, onSaved }: EditUserModalProps) {
  const { t } = useTranslation();
  const [partnerOrgId, setPartnerOrgId] = useState(user.partner_organization_id ?? "");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => updateUser(user.id, { partner_organization_id: partnerOrgId || null }),
    onSuccess: async (result) => {
      setServerError(null);
      toast.success(t("users.editSaved"));
      await onSaved(result);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      setServerError(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  return (
    <div
      className="oa-users-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oa-edit-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="oa-users-modal">
        {/* Modal header */}
        <div className="oa-users-modal-head">
          <div>
            <h2 id="oa-edit-title">
              <Icon className="oa-icon oa-icon-md">{ICONS.edit}</Icon>
              {t("users.actions.editProfile")}
            </h2>
            <p>
              {user.first_name} {user.last_name} · {user.email}
            </p>
          </div>
          <button
            type="button"
            className="oa-users-modal-close"
            aria-label={t("common.cancel")}
            onClick={onClose}
          >
            <Icon className="oa-icon oa-icon-md">{ICONS.close}</Icon>
          </button>
        </div>

        {/* Modal body */}
        <div className="oa-users-modal-body">
          <form id="oa-edit-form" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
            <PartnerOrgSelect
              id="oa-edit-partner-org"
              partners={partners}
              value={partnerOrgId}
              onChange={setPartnerOrgId}
            />
            {serverError && (
              <div className="oa-users-error" role="alert">{serverError}</div>
            )}
          </form>
        </div>

        {/* Modal footer */}
        <div className="oa-users-modal-foot">
          <span className="oa-users-modal-foot-note">
            <Icon>{ICONS.info}</Icon>
            {t("users.invite.permissionsNote")}
          </span>
          <div className="oa-users-modal-foot-actions">
            <button type="button" className="oa-btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="oa-edit-form"
              className="oa-btn-primary"
              disabled={mut.isPending}
            >
              <Icon>{ICONS.check}</Icon>
              {mut.isPending ? t("common.saving") : t("users.drawer.saveChanges")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
