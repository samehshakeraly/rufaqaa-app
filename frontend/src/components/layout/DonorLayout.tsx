import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-trust-500 text-white"
      : "text-gray-700 hover:bg-tranquil-100 dark:text-gray-200 dark:hover:bg-gray-700"
  }`;

/** Chrome for the authenticated donor area (post-signup, verified). */
export function DonorLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-snow dark:bg-gray-900">
      <header className="border-b border-sky-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link
            to="/donor/dashboard"
            className="text-xl font-bold text-trust-700"
          >
            {t("app.name")}
          </Link>
          <nav className="flex gap-2">
            <NavLink to="/donor/dashboard" className={navItemClass}>
              {t("donorNav.dashboard")}
            </NavLink>
            <NavLink to="/donor/sponsorships" className={navItemClass}>
              {t("donorNav.sponsorships")}
            </NavLink>
            <NavLink to="/orphans" className={navItemClass}>
              {t("donorNav.browseMore")}
            </NavLink>
            <NavLink to="/donor/profile" className={navItemClass}>
              {t("donorNav.profile")}
            </NavLink>
          </nav>
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
              onClick={logout}
              className="rounded-lg border border-sky-200 px-3 py-1 text-sm text-gray-700 hover:bg-tranquil-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
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
