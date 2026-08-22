import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** PR-D01 — the three doors out of the dashboard: sponsor another
 * child, the payments record, and the messages surface (with the
 * unread count when there is one). Arrows are SVG with `rtl:rotate-180`
 * — never a hand-typed arrow character. */
export function QuickActions({ unreadTotal }: { unreadTotal: number }) {
  const { t } = useTranslation();

  return (
    <section className="card space-y-1 p-5">
      <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
        {t("donor.dashboard.quick.title")}
      </h2>
      <ul className="divide-y divide-sky-200/60 dark:divide-gray-700">
        <ActionRow
          to="/orphans"
          title={t("donor.dashboard.quick.sponsor")}
          sub={t("donor.dashboard.quick.sponsorSub")}
          icon={
            <path
              d="M12 20s-7-4.35-9.33-8.11C1.06 9.3 2.16 6 5.4 6c2 0 3.2 1.14 3.83 2.2h5.54C15.4 7.14 16.6 6 18.6 6c3.24 0 4.34 3.3 2.73 5.89C19 15.65 12 20 12 20Z"
              strokeLinejoin="round"
            />
          }
        />
        <ActionRow
          to="/donor/payments"
          title={t("donor.dashboard.quick.statement")}
          sub={t("donor.dashboard.quick.statementSub")}
          icon={
            <>
              <path d="M4 6.5h16v11H4z" strokeLinejoin="round" />
              <path d="M4 10h16M7.5 14h4" strokeLinecap="round" />
            </>
          }
        />
        <ActionRow
          to="/donor/messages"
          title={t("donor.dashboard.quick.messages")}
          sub={
            unreadTotal > 0
              ? t("donor.dashboard.quick.messagesUnread", { count: unreadTotal })
              : t("donor.dashboard.quick.messagesSub")
          }
          badge={unreadTotal > 0 ? unreadTotal : null}
          icon={
            <path
              d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12Z"
              strokeLinejoin="round"
            />
          }
        />
      </ul>
    </section>
  );
}

function ActionRow({
  to,
  title,
  sub,
  icon,
  badge = null,
}: {
  to: string;
  title: string;
  sub: string;
  icon: ReactNode;
  badge?: number | null;
}) {
  return (
    <li>
      <Link
        to={to}
        className="group flex min-h-[44px] items-center gap-3 py-3 transition hover:bg-tranquil-100/60 dark:hover:bg-gray-700/40"
      >
        <span
          aria-hidden="true"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tranquil-100 text-trust-600 dark:bg-gray-700 dark:text-tranquil-200"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            {icon}
          </svg>
          {badge !== null && (
            <span className="absolute -top-1.5 -start-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-trust-500 px-1 text-[11px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {sub}
          </span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-gray-400 transition group-hover:text-trust-600 rtl:rotate-180 dark:group-hover:text-trust-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}
