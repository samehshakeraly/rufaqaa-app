import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, PM_ICONS } from "@/components/partner/icons";
import { PartnerTopbar } from "@/components/partner/PartnerTopbar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import {
  listUsers,
  reactivateUser,
  suspendUser,
  type AdminUser,
} from "@/lib/users";
import { toast } from "@/store/toasts";

import "./PartnerStaffPage.css";

type RoleFilter = "" | "manager" | "staff" | "reviewer" | "finance" | "disabled";

const QK = ["users", { scope: "pm-staff" }] as const;

// Map a server role string → mockup pill class + i18n key.
function rolePill(role: string): { cls: string; key: string } {
  if (role.includes("manager") || role.includes("admin"))
    return { cls: "manager", key: "manager" };
  if (role.includes("finance")) return { cls: "finance", key: "finance" };
  if (role.includes("staff") || role.includes("case"))
    return { cls: "staff", key: "staff" };
  return { cls: "reviewer", key: "reviewer" };
}

function avatarTone(id: string): string {
  const tones = ["", "c2", "c3", "c4", "c5"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return tones[h % tones.length] ?? "";
}

function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function axiosStatus(err: unknown): number | null {
  return err instanceof AxiosError ? err.response?.status ?? null : null;
}

export function PartnerStaffPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const { isAdmin } = useRole();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");
  const [search, setSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Partner staff register. Scoped to the partner roles. The backend may
  // gate /users to org-admins only; we surface that as a friendly notice
  // (the task's "keep stub-style copy" requirement) rather than an error.
  const usersQ = useQuery({
    queryKey: QK,
    queryFn: () => listUsers({ limit: 100, role: "partner_staff" }),
    retry: false,
  });
  const forbidden = axiosStatus(usersQ.error) === 403;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"], exact: false });
  const suspend = useMutation({
    mutationFn: (id: string) => suspendUser(id),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("users.suspended"));
    },
    onError: () => toast.error(t("common.createError")),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("users.reactivated"));
    },
    onError: () => toast.error(t("common.createError")),
  });

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

  const users = useMemo(() => usersQ.data?.items ?? [], [usersQ.data]);

  const counts = useMemo(() => {
    const c = { all: users.length, manager: 0, staff: 0, reviewer: 0, finance: 0, disabled: 0 };
    for (const u of users) {
      if (u.status === "suspended" || u.status === "disabled") c.disabled++;
      const p = rolePill(u.role).key;
      if (p === "manager") c.manager++;
      else if (p === "finance") c.finance++;
      else if (p === "staff") c.staff++;
      else if (p === "reviewer") c.reviewer++;
    }
    return c;
  }, [users]);

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (roleFilter === "") return true;
    if (roleFilter === "disabled")
      return u.status === "suspended" || u.status === "disabled";
    return rolePill(u.role).key === roleFilter;
  });

  const activeCount = users.filter((u) => u.status === "active").length;

  return (
    <>
      <PartnerTopbar
        title={t("partner.staff.title")}
        subtitle={t("partner.staff.subtitle")}
        actions={
          <>
            <button type="button" className="pm-btn-secondary">
              <Icon>{PM_ICONS.download}</Icon>
              {t("partner.staff.export")}
            </button>
            {/* TODO(backend): partner-scoped invite endpoint not wired;
                org-admin invite lives on the OA-02 Users screen. */}
            <button
              type="button"
              className="pm-btn-primary"
              onClick={() => toast.info(t("partner.staff.inviteHint"))}
            >
              <Icon>{PM_ICONS.plus}</Icon>
              {t("partner.staff.invite")}
            </button>
          </>
        }
      />

      <div className="pm-page">
        {forbidden ? (
          <div className="pm-notice" role="status">
            <Icon className="pm-icon">{PM_ICONS.info}</Icon>
            <span>{t("partner.staff.forbiddenNotice")}</span>
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="pm-staff-kpis">
              <div className="pm-staff-kpi">
                <div className="pm-staff-kpi-label">
                  <Icon>{PM_ICONS.check}</Icon>
                  {t("partner.staff.kpi.active")}
                </div>
                <div className="pm-staff-kpi-num">
                  <span className="pm-latin">{activeCount}</span>
                  <span className="pm-unit">
                    {t("partner.staff.kpi.ofTotal", { total: users.length })}
                  </span>
                </div>
                <div className="pm-staff-kpi-foot">{t("partner.staff.kpi.activeFoot")}</div>
              </div>
              {/* TODO(backend): no presence / online metric exposed. */}
              <div className="pm-staff-kpi">
                <div className="pm-staff-kpi-label">
                  <Icon>{PM_ICONS.chat}</Icon>
                  {t("partner.staff.kpi.online")}
                </div>
                <div className="pm-staff-kpi-num">
                  <span className="pm-latin">—</span>
                </div>
                <div className="pm-staff-kpi-foot">{t("partner.staff.kpi.onlineFoot")}</div>
              </div>
              {/* TODO(backend): no per-week transaction count exposed. */}
              <div className="pm-staff-kpi">
                <div className="pm-staff-kpi-label">
                  <Icon>{PM_ICONS.file}</Icon>
                  {t("partner.staff.kpi.weekTx")}
                </div>
                <div className="pm-staff-kpi-num">
                  <span className="pm-latin">—</span>
                </div>
                <div className="pm-staff-kpi-foot">{t("partner.staff.kpi.weekTxFoot")}</div>
              </div>
              {/* TODO(backend): no avg-processing-time metric exposed. */}
              <div className="pm-staff-kpi">
                <div className="pm-staff-kpi-label">
                  <Icon>{PM_ICONS.clock}</Icon>
                  {t("partner.staff.kpi.avgTime")}
                </div>
                <div className="pm-staff-kpi-num">
                  <span className="pm-latin">—</span>
                </div>
                <div className="pm-staff-kpi-foot">{t("partner.staff.kpi.avgTimeFoot")}</div>
              </div>
            </div>

            {/* Filter row */}
            <div className="pm-staff-filter">
              <div
                className="pm-role-tabs"
                role="tablist"
                aria-label={t("partner.staff.title")}
              >
                <RoleTab active={roleFilter === ""} onClick={() => setRoleFilter("")} label={t("partner.staff.roles.all")} count={counts.all} />
                <RoleTab active={roleFilter === "manager"} onClick={() => setRoleFilter("manager")} label={t("partner.staff.roles.managers")} count={counts.manager} />
                <RoleTab active={roleFilter === "staff"} onClick={() => setRoleFilter("staff")} label={t("partner.staff.roles.staff")} count={counts.staff} />
                <RoleTab active={roleFilter === "reviewer"} onClick={() => setRoleFilter("reviewer")} label={t("partner.staff.roles.reviewers")} count={counts.reviewer} />
                <RoleTab active={roleFilter === "finance"} onClick={() => setRoleFilter("finance")} label={t("partner.staff.roles.finance")} count={counts.finance} />
                <RoleTab active={roleFilter === "disabled"} onClick={() => setRoleFilter("disabled")} label={t("partner.staff.roles.disabled")} count={counts.disabled} />
              </div>
              <label className="pm-staff-search">
                <input
                  type="search"
                  placeholder={t("partner.staff.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("partner.staff.searchPlaceholder")}
                />
                <Icon>{PM_ICONS.search}</Icon>
              </label>
            </div>

            {/* States */}
            {usersQ.isLoading && <div className="pm-state">{t("common.loading")}</div>}
            {usersQ.error && !forbidden && (
              <div className="pm-state error">{t("common.loadError")}</div>
            )}
            {!usersQ.isLoading && !usersQ.error && filtered.length === 0 && (
              <div className="pm-empty neutral">
                <Icon className="pm-icon">{PM_ICONS.users}</Icon>
                <h3>{t("partner.staff.empty.title")}</h3>
                <p>{t("partner.staff.empty.body")}</p>
              </div>
            )}

            {/* Cards grid */}
            {!usersQ.isLoading && !usersQ.error && (
              <div className="pm-staff-grid">
                {filtered.map((u) => (
                  <StaffCard
                    key={u.id}
                    user={u}
                    isSelf={me?.id === u.id}
                    canManage={isAdmin}
                    menuOpen={openMenuId === u.id}
                    onToggleMenu={() =>
                      setOpenMenuId(openMenuId === u.id ? null : u.id)
                    }
                    onSuspend={() => {
                      if (window.confirm(t("partner.staff.disableConfirm"))) {
                        suspend.mutate(u.id);
                        setOpenMenuId(null);
                      }
                    }}
                    onReactivate={() => {
                      reactivate.mutate(u.id);
                      setOpenMenuId(null);
                    }}
                    busy={suspend.isPending || reactivate.isPending}
                  />
                ))}

                {/* Invite card — visual parity with the mockup. */}
                <button
                  type="button"
                  className="pm-invite-card"
                  onClick={() => toast.info(t("partner.staff.inviteHint"))}
                >
                  <div className="pm-invite-icon">
                    <Icon className="pm-icon">{PM_ICONS.userPlus}</Icon>
                  </div>
                  <div className="pm-invite-card-title">{t("partner.staff.invite")}</div>
                  <div className="pm-invite-card-sub">{t("partner.staff.inviteSub")}</div>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function RoleTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`pm-role-tab${active ? " active" : ""}`}
      onClick={onClick}
    >
      {label}
      <span className="pm-count pm-latin">{count}</span>
    </button>
  );
}

function StaffCard({
  user,
  isSelf,
  canManage,
  menuOpen,
  onToggleMenu,
  onSuspend,
  onReactivate,
  busy,
}: {
  user: AdminUser;
  isSelf: boolean;
  canManage: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const inactive = user.status === "suspended" || user.status === "disabled";
  const invited = user.status === "invited";
  const pill = rolePill(user.role);
  const tone = invited ? "off" : inactive ? "disabled" : avatarTone(user.id);
  const lastSeen = user.last_login_at
    ? new Date(user.last_login_at).toLocaleString(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : t("partner.staff.neverSeen");

  return (
    <article className={`pm-staff-card${inactive ? " inactive" : ""}`}>
      <div className="pm-staff-head">
        <div className={`pm-staff-avatar ${tone}`} aria-hidden="true">
          {invited ? <Icon>{PM_ICONS.userPlus}</Icon> : initials(user.first_name, user.last_name)}
        </div>
        <div>
          <div className="pm-staff-name">
            {user.first_name} {user.last_name}
          </div>
          <div className="pm-staff-email">{user.email}</div>
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="pm-staff-more"
            aria-label={t("users.cols.actions")}
            disabled={isSelf || !canManage}
            title={isSelf ? t("users.noSelfEdit") : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu();
            }}
          >
            <Icon>{PM_ICONS.dots}</Icon>
          </button>
          {menuOpen && canManage && (
            <div className="pm-staff-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              {user.status === "active" && (
                <button
                  type="button"
                  role="menuitem"
                  className="pm-staff-menu-item danger"
                  onClick={onSuspend}
                  disabled={busy}
                >
                  <Icon>{PM_ICONS.x}</Icon>
                  {t("users.actions.disable", "Disable")}
                </button>
              )}
              {inactive && (
                <button
                  type="button"
                  role="menuitem"
                  className="pm-staff-menu-item"
                  onClick={onReactivate}
                  disabled={busy}
                >
                  <Icon>{PM_ICONS.check}</Icon>
                  {t("users.reactivate")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pm-staff-roles">
        <span className={`pm-role-pill ${invited ? "invited" : inactive ? "disabled" : pill.cls}`}>
          {invited
            ? t("partner.staff.invitePending")
            : inactive
              ? t("partner.staff.accountDisabled")
              : t(`users.roles.${user.role}`, t(`partner.staff.rolePills.${pill.key}`))}
        </span>
      </div>

      {/* Per-staff productivity stats. TODO(backend): /users returns no
          approvals / orphans-supervised / tenure counts; shown as —. */}
      <div className="pm-staff-stats">
        <div className="pm-staff-stat">
          <div className="pm-staff-stat-num">—</div>
          <div className="pm-staff-stat-label">{t("partner.staff.stats.transactions")}</div>
        </div>
        <div className="pm-staff-stat">
          <div className="pm-staff-stat-num">—</div>
          <div className="pm-staff-stat-label">{t("partner.staff.stats.orphans")}</div>
        </div>
        <div className="pm-staff-stat">
          <div className="pm-staff-stat-num">—</div>
          <div className="pm-staff-stat-label">{t("partner.staff.stats.tenure")}</div>
        </div>
      </div>

      <div className={`pm-staff-foot${invited ? " warn" : ""}`}>
        <span>
          {invited ? t("partner.staff.inviteSent") : `${t("partner.staff.lastSeen")}: `}
          {!invited && <span className="pm-latin">{lastSeen}</span>}
        </span>
        <div className="pm-staff-foot-actions">
          {inactive && canManage && (
            <button
              type="button"
              className="pm-foot-btn"
              onClick={onReactivate}
              disabled={busy}
            >
              {t("users.reactivate")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
