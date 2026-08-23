import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** PR-W01 — the two doors that open the non-kafala tracks, sitting in
 * the donor dashboard header beside the greeting.
 *
 * They live in the HEADER, not in the content, so they are reachable in
 * every page state: while the dashboard loads, when its fetch failed,
 * and for a donor with no sponsorships at all. A donor who has not
 * started a kafala yet is exactly the one most likely to want these.
 *
 * Nothing but the component is exported from this file — the gate list
 * below stays module-local so `react-refresh/only-export-components`
 * (lint runs with --max-warnings 0) has nothing to flag. */
export function PortalGates() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("donor.dashboard.gates.label")}
      className="grid grid-cols-2 gap-3"
    >
      <Gate
        to="/donor/zakat"
        title={t("donor.dashboard.gates.zakat")}
        sub={t("donor.dashboard.gates.zakatSub")}
        icon={
          <>
            <path d="M12 3v18" strokeLinecap="round" />
            <path
              d="M5 8.5c0-2.2 1.6-3.5 7-3.5s7 1.3 7 3.5-1.6 3-5 3h-4c-3.4 0-5 .8-5 3s1.6 3.5 7 3.5 7-1.3 7-3.5"
              strokeLinecap="round"
            />
          </>
        }
      />
      <Gate
        to="/donor/waqf"
        title={t("donor.dashboard.gates.waqf")}
        sub={t("donor.dashboard.gates.waqfSub")}
        icon={
          <>
            <path d="M4 20h16" strokeLinecap="round" />
            <path d="M6 20v-8M10 20v-8M14 20v-8M18 20v-8" strokeLinecap="round" />
            <path d="M3.5 12h17L12 4.5 3.5 12Z" strokeLinejoin="round" />
          </>
        }
      />
    </nav>
  );
}

function Gate({
  to,
  title,
  sub,
  icon,
}: {
  to: string;
  title: string;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 transition hover:border-gray-300 hover:bg-gray-50 lg:w-[190px] dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          {icon}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-gray-900 dark:text-gray-100">
          {title}
        </span>
        <span className="block text-[11px] text-gray-500 dark:text-gray-400">
          {sub}
        </span>
      </span>
      {/* SVG chevron, mirrored under RTL — never a typed arrow character. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0 text-gray-400 rtl:rotate-180 dark:text-gray-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
