import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthStore } from "@/store/auth";

// Reuse the guardian portal chrome styles (glay-*) — this portal mirrors the
// guardian one, so it shares the calm white top-bar layout rather than
// duplicating ~240 lines of CSS.
import "./GuardianLayout.css";

/**
 * Chrome for the orphanage-manager portal ("بوابة دار الأيتام") — mirrors
 * GuardianLayout: a calm white top bar with the brand, a Home nav, and an
 * account chip + logout. The manager runs a residential dar; the chrome
 * itself carries no financial figures or donor identity.
 */
export function OrphanageManagerLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  const name = me?.first_name?.trim() || t("orphanageManager.layout.fallbackName");
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
              <p>{t("orphanageManager.layout.portalName")}</p>
            </div>
          </div>

          <nav className="glay-nav" aria-label={t("orphanageManager.layout.navLabel")}>
            <NavLink
              to="/orphanage-manager"
              end
              className={({ isActive }) =>
                `glay-nav-item${isActive ? " glay-nav-item--active" : ""}`
              }
            >
              <span aria-hidden="true" className="glay-nav-icon">
                <HomeIcon />
              </span>
              {t("orphanageManager.nav.home")}
            </NavLink>
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
            <button type="button" onClick={logout} className="glay-logout">
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
