import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { OrphanAvatar } from "@/components/donor/OrphanAvatar";
import type { NewsItem } from "@/lib/donorDashboard";
import { relativeFromNow } from "@/lib/format";

/** PR-D01 — "what reached you about your children": one merged timeline
 * of unread messages and fresh reports (see `buildNewsFeed`).
 *
 * The parent renders this ONLY when there are items — an empty feed
 * draws nothing, never a "nothing new" line. */
export function ChildrenFeed({ items, now }: { items: NewsItem[]; now: Date }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  return (
    <section className="card space-y-1 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
          {t("donor.dashboard.feed.title")}
        </h2>
        <Link
          to="/donor/orphans"
          className="text-sm font-medium text-trust-600 hover:underline dark:text-trust-100"
        >
          {t("donor.dashboard.feed.viewAll")}
        </Link>
      </div>

      <ul className="divide-y divide-sky-200/60 dark:divide-gray-700">
        {items.map((item) => {
          const s = item.card.sponsorship;
          const name = s.orphan_name ?? "—";
          const isMessage = item.kind === "message";
          return (
            <li
              key={`${item.kind}-${s.id}`}
              className="flex flex-wrap items-center gap-3 py-3.5"
            >
              <OrphanAvatar orphanId={s.orphan_id} name={name} size="md" />
              <div className="min-w-[160px] flex-1">
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  {isMessage ? (
                    <>
                      <span className="me-2 rounded-full bg-trust-500 px-2 py-0.5 text-[11px] font-bold text-white">
                        {t("donor.dashboard.feed.newBadge")}
                      </span>
                      {t("donor.dashboard.feed.newMessage", { name })}
                    </>
                  ) : item.milestoneLabel ? (
                    t("donor.dashboard.feed.milestone", {
                      name,
                      label: item.milestoneLabel,
                    })
                  ) : (
                    t("donor.dashboard.feed.report", { name })
                  )}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {relativeFromNow(item.at, lang, now)}
                </p>
              </div>
              <Link
                to={`/donor/orphans/${s.orphan_id}?tab=${isMessage ? "media" : "reports"}`}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-sky-200 bg-white px-3.5 py-2 text-sm font-medium text-trust-700 shadow-sm transition hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-trust-100 dark:hover:bg-gray-700"
              >
                {isMessage
                  ? t("donor.dashboard.feed.actionRead")
                  : t("donor.dashboard.feed.actionOpenReport")}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
