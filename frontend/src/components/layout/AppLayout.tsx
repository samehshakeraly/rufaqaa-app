import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { fetchOrganization } from "@/lib/organization";
import { useAuthStore } from "@/store/auth";

import "./AppLayout.css";

/**
 * Shell for the org-admin surface (/admin/*). Ported from
 * docs/design/screens/org-admin/OA-01: a fixed inline-start sidebar
 * (brand + static tenant block + grouped nav + user block) and a clean
 * top bar (page title + language switcher + sign-out). At ≤1024px the
 * sidebar collapses to an off-canvas drawer opened by the top-bar
 * hamburger.
 *
 * AppLayout is the shared chrome for every /admin role (org_admin,
 * finance, marketing_manager, partner_staff, …) so each nav item keeps
 * the role gate it had on the old top nav — only the presentation
 * changed. Routing targets, role guards and page content are untouched.
 */

// ── Inline stroke-icon set (sized via the `.oa-nav-ico` utility) ────────
function NavIco({ children }: { children: ReactNode }) {
  return (
    <svg className="oa-nav-ico" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}
const ICONS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  bars: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  globe: (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      <path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  userPlus: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
    </>
  ),
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14 2 9.27l6.91-1.01L12 2z" />,
  home: (
    <>
      <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />
      <circle cx="12" cy="14" r="2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  transfer: (
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  zakat: <path d="M12 2v20M5 9c0-3 2-5 7-5s7 2 7 5-2 4-5 4h-4c-3 0-5 1-5 4s2 5 7 5 7-2 7-5" />,
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  portal: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  signOut: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
} as const;

// Public transparency screen (W-03) — outside /admin, no auth required.
const TRANSPARENCY_PATH = "/transparency";

// Resolve the top-bar title from the current path. Ordered most-specific
// first; falls back to the brand subtitle. Rendered as plain text (not a
// heading) so it never competes with each page's own semantic <h1>.
const TITLE_MAP: ReadonlyArray<readonly [string, string]> = [
  ["/admin/dashboard", "nav.executiveDashboard"],
  ["/admin/orphans/new", "nav.registerOrphan"],
  ["/admin/orphans", "nav.orphans"],
  ["/admin/donors", "nav.donors"],
  ["/admin/families", "nav.families"],
  ["/admin/orphanages", "nav.orphanages"],
  ["/admin/partners", "nav.partners"],
  ["/admin/sponsorships", "nav.sponsorships"],
  ["/admin/reports", "nav.fullReports"],
  ["/admin/media-review", "nav.mediaReview"],
  ["/admin/marketing-channels", "nav.marketingChannels"],
  ["/admin/marketing/channels", "nav.marketingChannels"],
  ["/admin/payments", "nav.payments"],
  ["/admin/bank-transfers", "nav.bankTransfers"],
  ["/admin/finance/overdue", "nav.financeOverdue"],
  ["/admin/finance/reports", "nav.financeReports"],
  ["/admin/finance/import", "nav.finance"],
  ["/admin/finance", "nav.finance"],
  ["/admin/users", "nav.users"],
  ["/admin/audit", "nav.audit"],
  ["/admin/business-rules", "nav.businessRules"],
  ["/admin/settings", "nav.settings"],
];

function initialsOf(...parts: Array<string | null | undefined>): string {
  const letters = parts
    .map((p) => p?.trim()?.[0] ?? "")
    .join("")
    .slice(0, 2);
  return letters;
}

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();
  const {
    role,
    isAdmin,
    isFinance,
    isMarketing,
    isPartner,
    isPartnerApprover,
    isPartnerManager,
    isSuperAdmin,
  } = useRole();

  // Current organization — powers the (static) tenant block. Shares the
  // ["organization"] query key with the dashboard so no extra request
  // fires when both are mounted; failures are silent (block falls back
  // to the brand name).
  const { data: org } = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
    enabled: !!me,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes (incl. query string).
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  // Close on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Case-management surfaces — org admins and partner staff/managers.
  const isContentManager = isAdmin || isPartner;

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  // Display name: prefer the real first+last name, fall back to a neutral
  // label (never empty) — the seeded "Dev Admin" is real data, not a stub.
  const fullName = me
    ? [me.first_name, me.last_name].filter(Boolean).join(" ").trim()
    : "";
  const displayName = fullName || t("nav.userFallback");
  const userInitials = me ? initialsOf(me.first_name, me.last_name) : "";
  const roleLabel = role ? t(`users.roles.${role}`, { defaultValue: "" }) : "";

  // Org name + avatar for the tenant block.
  const orgName =
    org && (i18n.language === "ar" ? org.name_ar : org.name_en || org.name_ar);
  const orgInitials = orgName ? initialsOf(orgName) : "";

  // Top-bar page title.
  const titleKey =
    TITLE_MAP.find(([prefix]) => location.pathname.startsWith(prefix))?.[1] ??
    "nav.brandSubtitle";
  const pageTitle = t(titleKey);

  const navItemClass = ({ isActive }: { isActive: boolean }) =>
    `oa-nav-item${isActive ? " active" : ""}`;
  const portalItemClass = ({ isActive }: { isActive: boolean }) =>
    `oa-nav-item oa-nav-portal${isActive ? " active" : ""}`;

  return (
    <div className="oa-app">
      <a className="oa-skip-link" href="#oa-main-content">
        {t("nav.skipToContent")}
      </a>

      {drawerOpen && (
        <div
          className="oa-drawer-backdrop"
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside
        className={`oa-sidebar${drawerOpen ? " open" : ""}`}
        aria-label={t("nav.primary")}
      >
        {/* ── Brand ───────────────────────────────────────────────── */}
        <div className="oa-brand">
          <div className="oa-brand-mark" aria-hidden="true">
            ر
          </div>
          <div className="oa-brand-text">
            <div className="oa-brand-name">{t("app.name")}</div>
            <p>{t("nav.brandSubtitle")}</p>
          </div>
        </div>

        {/* ── Tenant block — STATIC, non-interactive.
            TODO(backend A-05): real multi-tenant switching. ───────── */}
        <div className="oa-tenant" aria-label={t("nav.tenantRegion")}>
          <span className="oa-tenant-logo" aria-hidden="true">
            {orgInitials || "ر"}
          </span>
          <span className="oa-tenant-name">{orgName || t("app.name")}</span>
          {roleLabel && <span className="oa-tenant-role">{roleLabel}</span>}
        </div>

        <nav className="oa-nav" aria-label={t("nav.primary")}>
          {/* ── التنفيذية / Executive ──────────────────────────────── */}
          {isContentManager && (
            <>
              <div className="oa-nav-section">{t("nav.section.executive")}</div>
              <NavLink to="/admin/dashboard" className={navItemClass}>
                <NavIco>{ICONS.grid}</NavIco>
                {t("nav.executiveDashboard")}
              </NavLink>
              <NavLink to="/admin/reports" className={navItemClass}>
                <NavIco>{ICONS.bars}</NavIco>
                {t("nav.fullReports")}
              </NavLink>
              <NavLink to={TRANSPARENCY_PATH} className={navItemClass}>
                <NavIco>{ICONS.globe}</NavIco>
                {t("nav.transparency")}
              </NavLink>
            </>
          )}

          {/* ── الإدارة / Administration ───────────────────────────── */}
          <div className="oa-nav-section">{t("nav.section.management")}</div>
          {isContentManager && (
            <>
              <NavLink to="/admin/orphans" end className={navItemClass}>
                <NavIco>{ICONS.star}</NavIco>
                {t("nav.orphans")}
              </NavLink>
              <NavLink to="/admin/orphans/new" className={navItemClass}>
                <NavIco>{ICONS.userPlus}</NavIco>
                {t("nav.registerOrphan")}
              </NavLink>
              <NavLink to="/admin/donors" className={navItemClass}>
                <NavIco>{ICONS.users}</NavIco>
                {t("nav.donors")}
              </NavLink>
              <NavLink to="/admin/families" className={navItemClass}>
                <NavIco>{ICONS.home}</NavIco>
                {t("nav.families")}
              </NavLink>
              <NavLink to="/admin/orphanages" className={navItemClass}>
                <NavIco>{ICONS.building}</NavIco>
                {t("nav.orphanages")}
              </NavLink>
              <NavLink to="/admin/sponsorships" className={navItemClass}>
                <NavIco>{ICONS.heart}</NavIco>
                {t("nav.sponsorships")}
              </NavLink>
              <NavLink to="/admin/partners" className={navItemClass}>
                <NavIco>{ICONS.building}</NavIco>
                {t("nav.partners")}
              </NavLink>
            </>
          )}
          {isAdmin && (
            <>
              <NavLink to="/admin/users" end className={navItemClass}>
                <NavIco>{ICONS.users}</NavIco>
                {t("nav.users")}
              </NavLink>
              <NavLink
                to="/admin/users?role=partner_staff"
                className={navItemClass}
              >
                <NavIco>{ICONS.userPlus}</NavIco>
                {t("nav.partnerStaff")}
              </NavLink>
            </>
          )}
          {isMarketing && (
            <NavLink to="/admin/marketing-channels" className={navItemClass}>
              <NavIco>{ICONS.home}</NavIco>
              {t("nav.marketingChannels")}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin/business-rules" className={navItemClass}>
              <NavIco>{ICONS.settings}</NavIco>
              {t("nav.businessRules")}
            </NavLink>
          )}

          {/* ── المالية / Finance ──────────────────────────────────── */}
          {isFinance && (
            <>
              <div className="oa-nav-section">{t("nav.section.finance")}</div>
              <NavLink to="/admin/finance" end className={navItemClass}>
                <NavIco>{ICONS.bars}</NavIco>
                {t("nav.finance")}
              </NavLink>
              <NavLink to="/admin/payments" className={navItemClass}>
                <NavIco>{ICONS.dollar}</NavIco>
                {t("nav.payments")}
              </NavLink>
              <NavLink to="/admin/bank-transfers" className={navItemClass}>
                <NavIco>{ICONS.transfer}</NavIco>
                {t("nav.bankTransfers")}
              </NavLink>
              <NavLink to="/admin/finance/overdue" className={navItemClass}>
                <NavIco>{ICONS.zakat}</NavIco>
                {t("nav.financeOverdue")}
              </NavLink>
              <NavLink to="/admin/finance/reports" className={navItemClass}>
                <NavIco>{ICONS.file}</NavIco>
                {t("nav.financeReports")}
              </NavLink>
            </>
          )}

          {/* ── الرقابة / Oversight ────────────────────────────────── */}
          {(isPartnerApprover || isAdmin) && (
            <div className="oa-nav-section">{t("nav.section.oversight")}</div>
          )}
          {isPartnerApprover && (
            <>
              <NavLink
                to="/admin/orphans?status=pending_review"
                className={navItemClass}
              >
                <NavIco>{ICONS.check}</NavIco>
                {t("nav.approvalsCenter")}
                {/* nav-badge slot — TODO(backend): no pending-review count
                    in the stats summary yet; omit rather than fabricate. */}
              </NavLink>
              <NavLink to="/admin/media-review" className={navItemClass}>
                <NavIco>{ICONS.image}</NavIco>
                {t("nav.mediaReview")}
              </NavLink>
            </>
          )}
          {isAdmin && (
            <>
              <NavLink to="/admin/audit" className={navItemClass}>
                <NavIco>{ICONS.file}</NavIco>
                {t("nav.audit")}
              </NavLink>
              {/* الإشعارات — no notifications surface yet. Rendered as a
                  non-interactive item (no fake link). TODO(backend). */}
              <button type="button" className="oa-nav-item" disabled>
                <NavIco>{ICONS.bell}</NavIco>
                {t("nav.notifications")}
                <span className="oa-nav-badge muted">{t("nav.soon")}</span>
              </button>
            </>
          )}

          {/* ── النظام / System ────────────────────────────────────── */}
          <div className="oa-nav-section">{t("nav.section.system")}</div>
          {/* مساعد رفقاء + مركز المساعدة — later features, non-interactive. */}
          <button type="button" className="oa-nav-item" disabled>
            <NavIco>{ICONS.chat}</NavIco>
            {t("nav.assistant")}
            <span className="oa-nav-badge muted">{t("nav.soon")}</span>
          </button>
          <button type="button" className="oa-nav-item" disabled>
            <NavIco>{ICONS.help}</NavIco>
            {t("nav.help")}
            <span className="oa-nav-badge muted">{t("nav.soon")}</span>
          </button>
          {isAdmin && (
            <NavLink to="/admin/settings" className={navItemClass}>
              <NavIco>{ICONS.settings}</NavIco>
              {t("nav.settings")}
            </NavLink>
          )}
          {/* Partner-manager portal entry — partner_manager only. */}
          {isPartnerManager && (
            <NavLink to="/partner/approvals" className={portalItemClass}>
              <NavIco>{ICONS.portal}</NavIco>
              {t("partner.portalBadge")}
            </NavLink>
          )}
          {/* Platform-administration entry — super_admin only. */}
          {isSuperAdmin && (
            <NavLink to="/platform" className={portalItemClass}>
              <NavIco>{ICONS.portal}</NavIco>
              {t("platform.modeBadge")}
            </NavLink>
          )}
        </nav>

        {/* ── User block (real admin user) ────────────────────────── */}
        <div className="oa-sidebar-foot">
          <div className="oa-user-avatar" aria-hidden="true">
            {userInitials}
          </div>
          <div className="oa-user-info">
            <div className="oa-user-name">{displayName}</div>
            {roleLabel && <div className="oa-user-role">{roleLabel}</div>}
          </div>
        </div>
      </aside>

      <div className="oa-main">
        <header className="oa-topbar">
          <button
            type="button"
            className="oa-hamburger"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label={drawerOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={drawerOpen}
          >
            <NavIco>{ICONS.menu}</NavIco>
          </button>
          {/* Plain text (not a heading) so it never competes with each
              page's own semantic <h1>. */}
          <div className="oa-topbar-title">{pageTitle}</div>
          <div className="oa-topbar-actions">
            <ThemeToggle />
            <LanguageSwitcher />
            <button type="button" onClick={logout} className="oa-logout-btn">
              <NavIco>{ICONS.signOut}</NavIco>
              {t("nav.logout")}
            </button>
          </div>
        </header>
        <main id="oa-main-content" className="oa-page" role="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
