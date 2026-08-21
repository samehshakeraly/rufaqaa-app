import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLogout } from "@/hooks/useLogout";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-trust-500 text-white"
      : "text-gray-700 hover:bg-tranquil-100 dark:text-gray-200 dark:hover:bg-gray-700"
  }`;

/** Chrome for the authenticated donor area (post-signup, verified).
 *
 * Tokens are unified on the design-system `gray-*` numeric ramps (the
 * same system the donor pages use) — no legacy `slate`/`bg-trust`/
 * `border-sky` mix. The six nav links live in their own scrollable row
 * below the brand bar, so nothing overflows off-screen on small
 * viewports. */
export function DonorLayout() {
  const { t } = useTranslation();
  const logout = useLogout();
  const { data: me } = useCurrentUser();

  return (
    <div className="min-h-screen bg-snow dark:bg-gray-900">
      <header className="border-b border-sky-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/donor/dashboard"
            className="shrink-0 text-xl font-bold text-trust-600 dark:text-trust-100"
          >
            {t("app.name")}
          </Link>
          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden text-sm text-gray-600 dark:text-gray-300 sm:inline">
                {me.first_name}
              </span>
            )}
            <ThemeToggle />
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-lg border border-sky-200 px-3 py-1 text-sm text-gray-700 hover:bg-tranquil-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>
        <nav
          aria-label={t("donorNav.ariaLabel")}
          className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3 sm:px-6"
        >
          <NavLink to="/donor/dashboard" className={navItemClass}>
            {t("donorNav.dashboard")}
          </NavLink>
          <NavLink to="/donor/sponsorships" className={navItemClass}>
            {t("donorNav.sponsorships")}
          </NavLink>
          <NavLink to="/donor/orphans" className={navItemClass}>
            {t("donorNav.myOrphans")}
          </NavLink>
          <NavLink to="/donor/messages" className={navItemClass}>
            {t("donorNav.messages")}
          </NavLink>
          <NavLink to="/orphans" className={navItemClass}>
            {t("donorNav.browseMore")}
          </NavLink>
          <NavLink to="/donor/profile" className={navItemClass}>
            {t("donorNav.profile")}
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
