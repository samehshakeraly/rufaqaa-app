import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-white text-trust-700"
      : "text-white/90 hover:bg-white/10"
  }`;

/**
 * Shell for the super-admin platform portal (SA-01..SA-04). Mirrors the
 * admin {@link AppLayout} structure/tokens but wears a distinct
 * trust-700 accent and a "Platform Administration" banner so it is
 * unmistakable that the user is operating ABOVE the per-tenant boundary
 * (cross-org reads/writes), not inside a single organisation.
 *
 * Mounting is gated by SuperAdminRoute, so this chrome is never rendered
 * for an org_admin.
 */
export function PlatformLayout() {
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
      {/* Platform-mode accent header — visually distinct from the org
          admin shell so super_admins always know their scope. */}
      <header className="border-b border-trust-800 bg-trust-700 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link to="/platform" className="text-xl font-bold text-white">
              {t("app.name")}
            </Link>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide">
              {t("platform.modeBadge")}
            </span>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label={t("platform.modeBadge")}>
            <NavLink to="/platform" end className={navItemClass}>
              {t("platform.nav.dashboard")}
            </NavLink>
            <NavLink to="/platform/organizations" className={navItemClass}>
              {t("platform.nav.organizations")}
            </NavLink>
            <NavLink to="/platform/analytics" className={navItemClass}>
              {t("platform.nav.analytics")}
            </NavLink>
            <NavLink to="/platform/settings" className={navItemClass}>
              {t("platform.nav.settings")}
            </NavLink>
          </nav>
          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden text-sm text-white/80 sm:inline">
                {me.first_name} {me.last_name}
              </span>
            )}
            <ThemeToggle />
            <LanguageSwitcher />
            <Link
              to="/admin/dashboard"
              className="rounded-lg border border-white/40 px-3 py-1 text-sm text-white hover:bg-white/10"
            >
              {t("platform.exitToAdmin")}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-white/40 px-3 py-1 text-sm text-white hover:bg-white/10"
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
