import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

type Role =
  | "super_admin"
  | "org_admin"
  | "partner_manager"
  | "partner_staff"
  | "marketing_manager"
  | "finance";

// Per-role nav allowlists are derived from docs/design/screens/{role}/*.html.
// Items without an explicit `roles` list are visible to every staff role.
const NAV_ITEMS: Array<{ to: string; labelKey: string; roles?: Role[] }> = [
  { to: "/admin/dashboard", labelKey: "nav.dashboard" },
  {
    to: "/admin/orphans",
    labelKey: "nav.orphans",
    roles: [
      "super_admin",
      "org_admin",
      "partner_manager",
      "partner_staff",
      "marketing_manager",
    ],
  },
  {
    to: "/admin/donors",
    labelKey: "nav.donors",
    roles: [
      "super_admin",
      "org_admin",
      "partner_manager",
      "finance",
      "marketing_manager",
    ],
  },
  {
    to: "/admin/partners",
    labelKey: "nav.partners",
    roles: ["super_admin", "org_admin"],
  },
  {
    to: "/admin/families",
    labelKey: "nav.families",
    roles: ["super_admin", "org_admin", "partner_manager", "partner_staff"],
  },
  {
    to: "/admin/sponsorships",
    labelKey: "nav.sponsorships",
    roles: [
      "super_admin",
      "org_admin",
      "partner_manager",
      "partner_staff",
      "finance",
    ],
  },
  {
    to: "/admin/payments",
    labelKey: "nav.payments",
    roles: ["super_admin", "org_admin", "finance"],
  },
  {
    to: "/admin/bank-transfers",
    labelKey: "nav.bankTransfers",
    roles: ["super_admin", "org_admin", "finance", "partner_manager"],
  },
  {
    to: "/admin/reports",
    labelKey: "nav.reports",
    roles: ["super_admin", "org_admin", "partner_manager", "partner_staff"],
  },
  {
    to: "/admin/users",
    labelKey: "nav.users",
    roles: ["super_admin", "org_admin", "partner_manager"],
  },
  {
    to: "/admin/marketing-channels",
    labelKey: "nav.marketingChannels",
    roles: ["super_admin", "org_admin", "marketing_manager"],
  },
  {
    to: "/admin/audit",
    labelKey: "nav.audit",
    roles: ["super_admin", "org_admin", "finance"],
  },
  { to: "/admin/settings", labelKey: "nav.settings" },
];

// Role accent strip uses tokens already in tailwind.config.js — no new colors.
// finance      → success-700 (mockup --fin-700 = #047857 = success-700)
// marketing    → info-700    (mockup --info-700 = #1D4ED8)
// partner/org  → trust-500   (mockup default)
const ROLE_STRIP: Partial<Record<Role, string>> = {
  finance: "bg-success-700",
  marketing_manager: "bg-info-700",
};
const DEFAULT_STRIP = "bg-trust-500";

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-trust-500 text-white"
      : "text-gray-700 hover:bg-tranquil-100 dark:text-gray-200 dark:hover:bg-gray-700"
  }`;

export function AppLayout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();
  const { role } = useRole();
  const stripClass =
    (role && ROLE_STRIP[role as Role]) || DEFAULT_STRIP;

  function logout() {
    clear();
    navigate("/login", { replace: true });
  }

  const visibleNav = role
    ? NAV_ITEMS.filter(
        (item) => !item.roles || item.roles.includes(role as Role),
      )
    : NAV_ITEMS;

  return (
    <div className="min-h-screen bg-snow dark:bg-gray-900">
      <header className="border-b border-sky-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link
            to="/admin/dashboard"
            className="text-xl font-bold text-trust-700"
          >
            {t("app.name")}
          </Link>
          <nav
            className="flex gap-2"
            aria-label={t("nav.dashboard")}
          >
            {visibleNav.map((item) => (
              <NavLink key={item.to} to={item.to} className={navItemClass}>
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {me && (
              <span className="hidden text-sm text-gray-600 dark:text-gray-300 sm:inline">
                {me.first_name} {me.last_name}
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
        <div
          className={`h-1 w-full ${stripClass}`}
          aria-hidden="true"
          data-role-strip={role ?? "default"}
        />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
