import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? "bg-trust text-white" : "text-slate-700 hover:bg-tranquil"
  }`;

export function AppLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-snow">
      <header className="border-b border-sky bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="text-xl font-bold text-trust">
            {t("app.name")}
          </Link>
          <nav className="flex gap-2">
            <NavLink to="/dashboard" className={navItemClass}>
              {t("nav.dashboard")}
            </NavLink>
            <NavLink to="/orphans" className={navItemClass}>
              {t("nav.orphans")}
            </NavLink>
            <NavLink to="/donors" className={navItemClass}>
              {t("nav.donors")}
            </NavLink>
            <NavLink to="/sponsorships" className={navItemClass}>
              {t("nav.sponsorships")}
            </NavLink>
            <NavLink to="/payments" className={navItemClass}>
              {t("nav.payments")}
            </NavLink>
          </nav>
          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden text-sm text-slate-600 sm:inline">
                {me.first_name} {me.last_name}
              </span>
            )}
            <LanguageSwitcher />
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
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
