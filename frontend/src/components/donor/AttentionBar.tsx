import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { AttentionSummary } from "@/lib/donorDashboard";
import { daysOverdue } from "@/lib/donorDashboard";
import type { OrphanCardData } from "@/lib/donorOrphans";

/** PR-D01 — the dashboard's opening signal: what needs the donor NOW.
 *
 * Two signals only, in order: overdue payments, then unread messages.
 * Everything renders on `warning` tokens — never `danger`; nothing in a
 * donor's face looks like an alarm. When there is no signal at all the
 * bar is not drawn — `CalmBar` (green, one sentence) takes its place. */

/** Above this many overdue rows the list collapses into one aggregated
 * row with a single "review them all" action. */
const OVERDUE_ROW_CAP = 3;

function childName(card: OrphanCardData): string {
  return card.sponsorship.orphan_name ?? "—";
}

/** Renewal goes straight to checkout when the orphan code exists,
 * otherwise to the child's journey page. */
function renewPath(card: OrphanCardData): string {
  const s = card.sponsorship;
  return s.orphan_code
    ? `/sponsor/${s.orphan_code}/checkout`
    : `/donor/orphans/${s.orphan_id}`;
}

function joinNames(names: string[], lang: string): string {
  try {
    return new Intl.ListFormat(lang, {
      style: "long",
      type: "conjunction",
    }).format(names);
  } catch {
    return names.join("، ");
  }
}

export function AttentionBar({
  attention,
  now,
}: {
  attention: AttentionSummary;
  now: Date;
}) {
  const { t, i18n } = useTranslation();
  const { overdue, unread, unreadTotal } = attention;

  const collapseOverdue = overdue.length > OVERDUE_ROW_CAP;
  const rowCount =
    (collapseOverdue ? 1 : overdue.length) + (unread.length > 0 ? 1 : 0);

  return (
    <section
      aria-label={t("donor.dashboard.attention.subtitle")}
      className="rounded-2xl border border-warning-100 bg-warning-50 p-4 dark:border-warning-500/25 dark:bg-warning-500/10 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-warning-600"
          aria-hidden="true"
        >
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9.2" />
        </svg>
        <h2 className="text-sm font-bold text-warning-700 dark:text-warning-500">
          {rowCount === 1
            ? t("donor.dashboard.attention.titleOne")
            : t("donor.dashboard.attention.titleMany", { count: rowCount })}
        </h2>
      </div>

      <ul className="space-y-2.5">
        {collapseOverdue ? (
          <li className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-white p-3.5 dark:border-gray-700 dark:bg-gray-800">
            <p className="min-w-[180px] flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("donor.dashboard.attention.overdueMany", {
                count: overdue.length,
              })}
            </p>
            <Link
              to="/donor/orphans"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-warning-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-warning-700"
            >
              {t("donor.dashboard.attention.actionReviewAll")}
            </Link>
          </li>
        ) : (
          overdue.map((card) => {
            const days = daysOverdue(card, now);
            const name = childName(card);
            return (
              <li
                key={card.sponsorship.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-white p-3.5 dark:border-gray-700 dark:bg-gray-800"
              >
                <p className="min-w-[180px] flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {days === null
                    ? t("donor.dashboard.attention.overdueNoDays", { name })
                    : t("donor.dashboard.attention.overdue", {
                        name,
                        count: days,
                      })}
                </p>
                <Link
                  to={renewPath(card)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-warning-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-warning-700"
                >
                  {t("donor.dashboard.attention.actionRenew", { name })}
                </Link>
              </li>
            );
          })
        )}

        {unread.length > 0 && (
          <li className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-white p-3.5 dark:border-gray-700 dark:bg-gray-800">
            <p className="min-w-[180px] flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("donor.dashboard.attention.unread", {
                count: unreadTotal,
                names: joinNames(unread.map(childName), i18n.language),
              })}
            </p>
            <Link
              to="/donor/messages"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-trust-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-trust-600"
            >
              {t("donor.dashboard.attention.actionRead")}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

/** No overdue payment, no unread message — one green sentence, and the
 * orange bar is never drawn. */
export function CalmBar() {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("donor.dashboard.calm.lead")}
      className="flex items-center gap-3 rounded-2xl border border-success-100 bg-success-50 p-4 dark:border-success-500/25 dark:bg-success-500/10 sm:p-5"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="shrink-0 text-success-600"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9.2" />
        <path d="m8 12.5 2.8 2.8L16.5 9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm text-success-700 dark:text-success-500">
        <span className="font-bold">{t("donor.dashboard.calm.lead")}</span>{" "}
        {t("donor.dashboard.calm.body")}
      </p>
    </section>
  );
}
