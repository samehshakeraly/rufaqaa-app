import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLogout } from "@/hooks/useLogout";

import "./GuardianLayout.css";

/**
 * Chrome for the guardian family portal ("بوابة ولي الأمر") — a calm white
 * top bar with the brand, a Home / Messages nav, and an account chip + logout.
 * Mirrors the OrphanLayout/PartnerLayout convention of a role-specific layout
 * with its own scoped styles; ported from the guardian mockups (G-01..G-05).
 *
 * CHILD-DATA SENSITIVITY: this portal shows a child's reports and documents.
 * The chrome itself carries no financial figures or donor identity.
 */
export function GuardianLayout() {
  const { t } = useTranslation();
  const logout = useLogout();
  const { data: me } = useCurrentUser();

  const name = me?.first_name?.trim() || t("guardian.layout.fallbackName");
  const initials = name.slice(0, 2);

  return (
    <div className="glay-root">
      <header className="glay-header" role="banner">
        <div className="glay-header-inner">
          <div className="glay-brand">
            <span className="glay-brand-mark" aria-hidden="true">
              ر
            </span>
            <div className="glay-brand-info">
              <h1>{t("auth.login.brandName")}</h1>
              <p>{t("guardian.layout.portalName")}</p>
            </div>
          </div>

          <nav className="glay-nav" aria-label={t("guardian.layout.navLabel")}>
            <GuardianNavItem to="/guardian" end label={t("guardian.nav.home")}>
              <HomeIcon />
            </GuardianNavItem>
            <GuardianNavItem
              to="/guardian/messages"
              label={t("guardian.nav.messages")}
            >
              <MessageIcon />
            </GuardianNavItem>
          </nav>

          <div className="glay-actions">
            <ThemeToggle />
            <LanguageSwitcher />
            <span className="glay-chip">
              <span className="glay-chip-avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="glay-chip-name">{name}</span>
            </span>
            <button type="button" onClick={() => logout("/guardian/login")} className="glay-logout">
              {t("nav.logout")}
            </button>
          </div>
        </div>
      </header>

      <main className="glay-main">
        <Outlet />
      </main>
    </div>
  );
}

function GuardianNavItem({
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
        `glay-nav-item${isActive ? " glay-nav-item--active" : ""}`
      }
    >
      <span aria-hidden="true" className="glay-nav-icon">
        {children}
      </span>
      {label}
    </NavLink>
  );
}

const iconProps = {
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

function MessageIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
