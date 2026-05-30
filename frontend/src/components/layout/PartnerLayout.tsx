import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon, PM_ICONS } from "@/components/partner/icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

import "./PartnerLayout.css";

/**
 * Shell for the partner-manager portal (PM-01..PM-04). Ported from the
 * docs/design/screens/partner-mgr mockups: a fixed inline-start sidebar
 * ("بوابة الجهة الشريكة") plus a per-page sticky topbar rendered by each
 * page via {@link PartnerTopbar}. Mounting is gated by PartnerRoute, so
 * this chrome is only ever rendered for partner-approver roles
 * (super_admin, org_admin, partner_manager); partner_staff is redirected
 * home. The org-admin {@link AppLayout} is left untouched.
 */
export function PartnerLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  const initials = me
    ? `${me.first_name?.charAt(0) ?? ""}${me.last_name?.charAt(0) ?? ""}`
    : "";

  return (
    <div className="pm-app">
      <aside className="pm-sidebar" aria-label={t("partner.nav.section")}>
        <div className="pm-brand">
          <div className="pm-brand-mark" aria-hidden="true">
            ر
          </div>
          <div className="pm-brand-text">
            <div className="pm-brand-name">{t("app.name")}</div>
            <p>{t("partner.portalName")}</p>
          </div>
        </div>

        <div className="pm-tenant">
          <span className="pm-tenant-logo" aria-hidden="true">
            {t("partner.tenantShort")}
          </span>
          <span className="pm-tenant-name">{t("partner.tenantName")}</span>
          <span className="pm-role-badge">{t("partner.managerShort")}</span>
        </div>

        <div className="pm-nav-section">{t("partner.nav.section")}</div>
        <PartnerNavItem to="/partner/approvals" icon={PM_ICONS.check}>
          {t("partner.nav.approvals")}
        </PartnerNavItem>
        <PartnerNavItem to="/partner/staff" icon={PM_ICONS.users}>
          {t("partner.nav.staff")}
        </PartnerNavItem>
        <PartnerNavItem to="/partner/transfers" icon={PM_ICONS.dollar}>
          {t("partner.nav.transfers")}
        </PartnerNavItem>
        <PartnerNavItem to="/partner/performance" icon={PM_ICONS.bars}>
          {t("partner.nav.performance")}
        </PartnerNavItem>

        <div className="pm-nav-section">{t("partner.nav.opsSection")}</div>
        {/* Cross-link back to the shared admin screens, which carry the
            full orphan/report registers (org-admin styled). */}
        <NavLink
          to="/admin/orphans"
          className={({ isActive }) =>
            `pm-nav-item${isActive ? " active" : ""}`
          }
        >
          <Icon>{PM_ICONS.users}</Icon>
          {t("partner.nav.allOrphans")}
        </NavLink>
        <NavLink
          to="/admin/reports"
          className={({ isActive }) =>
            `pm-nav-item${isActive ? " active" : ""}`
          }
        >
          <Icon>{PM_ICONS.file}</Icon>
          {t("partner.nav.reports")}
        </NavLink>

        <div className="pm-sidebar-foot">
          <div className="pm-user-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="pm-user-info">
            <div className="pm-user-name">
              {me ? `${me.first_name} ${me.last_name}` : ""}
            </div>
            <div className="pm-user-role">{t("partner.managerRole")}</div>
          </div>
          <ThemeToggle />
          <LanguageSwitcher />
          <button
            type="button"
            className="pm-sidebar-logout"
            onClick={logout}
            aria-label={t("nav.logout")}
            title={t("nav.logout")}
          >
            <Icon>{PM_ICONS.x}</Icon>
          </button>
        </div>
      </aside>

      <div className="pm-main">
        <Outlet />
      </div>
    </div>
  );
}

function PartnerNavItem({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `pm-nav-item${isActive ? " active" : ""}`}
    >
      <Icon>{icon}</Icon>
      {children}
    </NavLink>
  );
}
