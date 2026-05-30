import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { HeartIcon } from "@/components/public/icons";
import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

import { CONTAINER } from "./ui";

/**
 * Shared public-site navigation, extracted from the W-01 landing shell
 * and used across every public page (W-01..W-06). Sticky, translucent
 * header with the brand mark, links to all public routes, a language
 * toggle (Arabic ↔ English — these pages target international donors),
 * and a "donate now" CTA. Auth-aware: logged-in donors/staff get a
 * "go to my area" link instead of login/donate.
 */

/** The six public marketing routes surfaced in the primary nav. */
const NAV_LINKS: { to: string; key: string; end?: boolean }[] = [
  { to: "/", key: "public.nav.home", end: true },
  { to: "/how-it-works", key: "public.nav.howItWorks" },
  { to: "/transparency", key: "public.nav.transparency" },
  { to: "/partners", key: "public.nav.partners" },
  { to: "/about", key: "public.nav.about" },
  { to: "/contact", key: "public.nav.contact" },
];

export function PublicNav() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.accessToken);
  const { homePath, isDonor, isStaff } = useRole();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive
        ? "bg-tranquil-100 text-trust-600 dark:bg-gray-700 dark:text-trust-100"
        : "text-gray-700 hover:bg-tranquil-100 hover:text-trust-600 dark:text-gray-200 dark:hover:bg-gray-700"
    }`;

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 border-b border-sky-200 bg-snow-100/90 backdrop-blur supports-[backdrop-filter]:bg-snow-100/80 dark:border-gray-700 dark:bg-gray-900/90"
    >
      <div className={`${CONTAINER} flex items-center justify-between gap-6 py-3`}>
        <Link to="/" className="flex items-center gap-3" aria-label={t("public.nav.home")}>
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-bl from-trust-300 to-trust-500 text-xl font-semibold text-white shadow-sm"
          >
            ر
          </span>
          <span className="leading-tight">
            <span className="block text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("app.name")}
            </span>
            <span className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {t("public.brand.tagline")}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label={t("public.nav.primary")}>
          {NAV_LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
              {t(l.key)}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {!token && (
            <>
              <Link
                to="/login"
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-tranquil-100 hover:text-trust-600 sm:inline-flex dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t("public.nav.login")}
              </Link>
              <Link
                to="/orphans"
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-bl from-trust-400 to-trust-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-trust-500 hover:to-trust-600"
              >
                <HeartIcon className="h-4 w-4" />
                {t("public.nav.donate")}
              </Link>
            </>
          )}
          {token && (isDonor || isStaff) && (
            <Link
              to={homePath}
              className="inline-flex items-center rounded-lg bg-gradient-to-bl from-trust-400 to-trust-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-trust-500 hover:to-trust-600"
            >
              {t("public.nav.toMyArea")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
