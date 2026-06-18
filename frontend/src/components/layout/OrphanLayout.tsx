import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLogout } from "@/hooks/useLogout";

/**
 * Chrome for the orphan self-portal — deliberately separate from the
 * donor/guardian/admin layouts. Warm top bar (greeting + avatar +
 * logout) plus an icon nav for Home / Messages / Achievements. Tone is
 * simple and encouraging; this portal serves 12–17 year-olds.
 */
export function OrphanLayout() {
  const { t } = useTranslation();
  const logout = useLogout();
  const { data: me } = useCurrentUser();

  const initial = me?.first_name?.trim().charAt(0) ?? "🌟";

  return (
    <div className="min-h-screen bg-tranquil-100 dark:bg-gray-900">
      <header className="border-b border-sky-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-trust-100 text-lg font-bold text-trust-700"
            >
              {initial}
            </span>
            <p className="text-base font-semibold text-trust-700 dark:text-trust-100">
              {t("orphan.layout.greeting", { name: me?.first_name ?? "" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => logout("/orphan/login")}
              className="rounded-xl border border-sky-200 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-tranquil-200 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t("nav.logout")}
            </button>
          </div>
        </div>

        <nav
          aria-label={t("orphan.layout.navLabel")}
          className="mx-auto flex max-w-3xl items-center justify-center gap-2 px-5 pb-3"
        >
          <OrphanNavItem to="/orphan" end label={t("orphanNav.home")}>
            <HomeIcon />
          </OrphanNavItem>
          <OrphanNavItem to="/orphan/messages" label={t("orphanNav.messages")}>
            <HeartIcon />
          </OrphanNavItem>
          <OrphanNavItem
            to="/orphan/achievements"
            label={t("orphanNav.achievements")}
          >
            <TrophyIcon />
          </OrphanNavItem>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function OrphanNavItem({
  to,
  end,
  label,
  children,
}: {
  to: string;
  end?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
          isActive
            ? "bg-trust-500 text-white"
            : "text-gray-700 hover:bg-tranquil-200 dark:text-gray-200 dark:hover:bg-gray-700"
        }`
      }
    >
      <span aria-hidden="true">{children}</span>
      {label}
    </NavLink>
  );
}

const iconProps = {
  className: "h-5 w-5",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M5 4H3v2a3 3 0 0 0 3 3" />
      <path d="M19 4h2v2a3 3 0 0 1-3 3" />
    </svg>
  );
}
