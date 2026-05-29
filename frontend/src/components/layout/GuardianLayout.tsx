import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-trust text-white"
      : "text-slate-700 hover:bg-tranquil dark:text-slate-200 dark:hover:bg-slate-700"
  }`;

/** Chrome for the authenticated guardian self-portal. Mirrors
 * {@link DonorLayout}; intentionally NOT the admin AppLayout. */
export function GuardianLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-snow dark:bg-slate-900">
      <header className="border-b border-sky bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/guardian" className="text-xl font-bold text-trust">
            {t("app.name")}
          </Link>
          <nav className="flex gap-2">
            <NavLink to="/guardian" end className={navItemClass}>
              {t("guardianNav.dashboard")}
            </NavLink>
            <NavLink to="/guardian/messages" className={navItemClass}>
              {t("guardianNav.messages")}
            </NavLink>
          </nav>
          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">
                {me.first_name}
              </span>
            )}
            <ThemeToggle />
            <LanguageSwitcher />
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
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
