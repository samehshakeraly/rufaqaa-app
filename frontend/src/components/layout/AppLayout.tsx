import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-trust text-white"
      : "text-gray-700 hover:bg-tranquil dark:text-gray-200 dark:hover:bg-gray-700"
  }`;

export function AppLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();
  const { isAdmin, isPartner, isPartnerApprover, isGuardian } = useRole();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-snow dark:bg-gray-900">
      <header className="border-b border-sky bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/admin/dashboard" className="text-xl font-bold text-trust">
            {t("app.name")}
          </Link>
          <nav className="flex gap-2">
            <NavLink to="/admin/dashboard" className={navItemClass}>
              {t("nav.dashboard")}
            </NavLink>
            <NavLink to="/admin/orphans" className={navItemClass}>
              {t("nav.orphans")}
            </NavLink>
            {(isPartner || isAdmin) && (
              <NavLink to="/admin/orphans/new" className={navItemClass}>
                {t("nav.registerOrphan")}
              </NavLink>
            )}
            {isPartnerApprover && (
              <NavLink
                to="/admin/orphans?status=pending_review"
                className={navItemClass}
              >
                {t("nav.approvals")}
              </NavLink>
            )}
            {isPartnerApprover && (
              <NavLink to="/admin/media-review" className={navItemClass}>
                {t("nav.mediaReview")}
              </NavLink>
            )}
            <NavLink to="/admin/donors" className={navItemClass}>
              {t("nav.donors")}
            </NavLink>
            <NavLink to="/admin/partners" className={navItemClass}>
              {t("nav.partners")}
            </NavLink>
            <NavLink to="/admin/families" className={navItemClass}>
              {t("nav.families")}
            </NavLink>
            <NavLink to="/admin/sponsorships" className={navItemClass}>
              {t("nav.sponsorships")}
            </NavLink>
            <NavLink to="/admin/payments" className={navItemClass}>
              {t("nav.payments")}
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin/bank-transfers" className={navItemClass}>
                {t("nav.bankTransfers")}
              </NavLink>
            )}
            <NavLink to="/admin/reports" className={navItemClass}>
              {t("nav.reports")}
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin/users" className={navItemClass}>
                {t("nav.users")}
              </NavLink>
            )}
            {isAdmin && (
              <NavLink
                to="/admin/users?role=partner_staff"
                className={navItemClass}
              >
                {t("nav.partnerStaff")}
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin/marketing-channels" className={navItemClass}>
                {t("nav.marketingChannels")}
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin/audit" className={navItemClass}>
                {t("nav.audit")}
              </NavLink>
            )}
            <NavLink to="/admin/settings" className={navItemClass}>
              {t("nav.settings")}
            </NavLink>
            {/* Rare: a guardian who also holds admin chrome gets a link
                back to their own portal. */}
            {isGuardian && (
              <NavLink to="/guardian" className={navItemClass}>
                {t("guardianNav.dashboard")}
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden text-sm text-gray-600 dark:text-gray-300 sm:inline">
                {me.first_name} {me.last_name}
              </span>
            )}
            <ThemeToggle />
            <LanguageSwitcher />
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-sky px-3 py-1 text-sm text-gray-700 hover:bg-tranquil dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
