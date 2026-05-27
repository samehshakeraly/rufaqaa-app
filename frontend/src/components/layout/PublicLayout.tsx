import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

/**
 * Chrome for anonymous + just-browsing visitors. Header collapses to
 * a "go to your area" CTA if the visitor is already logged in.
 */
export function PublicLayout() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.accessToken);
  const { homePath, isDonor, isStaff } = useRole();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${
      isActive ? "bg-trust text-white" : "text-slate-700 hover:bg-tranquil"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-snow">
      <header className="border-b border-sky bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="text-xl font-bold text-trust">
            {t("app.name")}
          </Link>
          <nav className="flex items-center gap-2">
            <NavLink to="/orphans" className={navClass}>
              {t("public.nav.browseOrphans")}
            </NavLink>
            <LanguageSwitcher />
            {!token && (
              <>
                <Link
                  to="/login"
                  className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
                >
                  {t("public.nav.login")}
                </Link>
                <Link to="/signup" className="btn-primary">
                  {t("public.nav.signup")}
                </Link>
              </>
            )}
            {token && (isDonor || isStaff) && (
              <Link to={homePath} className="btn-primary">
                {t("public.nav.toMyArea")}
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      <footer className="mt-auto border-t border-sky bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4 text-sm text-slate-600">
          <p>
            © {new Date().getFullYear()} {t("app.name")}
          </p>
          <nav className="flex gap-3">
            <a href="#" className="hover:underline">
              {t("public.footer.terms")}
            </a>
            <a href="#" className="hover:underline">
              {t("public.footer.privacy")}
            </a>
            <a href="#" className="hover:underline">
              {t("public.footer.contact")}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
