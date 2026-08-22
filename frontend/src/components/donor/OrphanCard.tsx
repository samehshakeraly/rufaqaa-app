import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { OrphanAvatar } from "@/components/donor/OrphanAvatar";
import type { OrphanCardData } from "@/lib/donorOrphans";
import { relationshipSignal } from "@/lib/donorOrphans";
import {
  formatDate,
  formatDuration,
  humanDuration,
  relativeFromNow,
} from "@/lib/format";
import { formatMoney } from "@/lib/money";

/** PR-D06 — one sponsored child, as a relationship, not an invoice.
 *
 * The card is an <article>, NOT a <Link>: the child's name links to the
 * journey page, and the actions row carries real, separately focusable
 * controls (no stretched-link overlay). The primary action changes with
 * the state of the relationship; the two secondary icon actions (message
 * / profile & reports) are always present and always labelled. */

const STATUS_PILL: Record<string, string> = {
  active:
    "bg-success-100 text-success-700 dark:bg-success-700/30 dark:text-success-100",
  overdue:
    "bg-warning-100 text-warning-700 dark:bg-warning-700/30 dark:text-warning-100",
  paused: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
};

const ICON_BTN =
  "relative flex h-11 w-11 items-center justify-center rounded-xl border border-sky-200 bg-white text-trust-700 shadow-sm transition hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-trust-100 dark:hover:bg-gray-700";

export function OrphanCard({ card, now }: { card: OrphanCardData; now?: Date }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const s = card.sponsorship;
  const name = s.orphan_name ?? "—";
  const detailPath = `/donor/orphans/${s.orphan_id}`;
  const signal = relationshipSignal(card, now ?? new Date());

  const since = humanDuration(s.start_date);
  const sinceText = since
    ? t("donor.orphans.since", { name, duration: formatDuration(since, t) })
    : null;

  // The one primary action for the current state of the relationship.
  const primary =
    s.status === "overdue"
      ? {
          to: s.orphan_code ? `/sponsor/${s.orphan_code}/checkout` : detailPath,
          label: t("donor.orphans.actions.renew"),
          className:
            "bg-warning-600 text-white hover:bg-warning-700 active:bg-warning-700",
        }
      : s.status === "paused"
        ? {
            to: `${detailPath}?tab=sponsorship`,
            label: t("donor.orphans.actions.resume"),
            className:
              "bg-trust-500 text-white hover:bg-trust-600 active:bg-trust-700",
          }
        : card.unreadCount > 0
          ? {
              to: `${detailPath}?tab=media`,
              label: t("donor.orphans.actions.readMessage"),
              className:
                "bg-trust-500 text-white hover:bg-trust-600 active:bg-trust-700",
            }
          : {
              to: detailPath,
              label: t("donor.orphans.actions.viewDetail"),
              className:
                "bg-trust-500 text-white hover:bg-trust-600 active:bg-trust-700",
            };

  const messageLabel =
    card.unreadCount > 0
      ? t("donor.orphans.actions.messageUnread", {
          name,
          n: card.unreadCount,
        })
      : t("donor.orphans.actions.message", { name });
  const profileLabel = t("donor.orphans.actions.profile", { name });

  return (
    <article className="card flex h-full flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <OrphanAvatar orphanId={s.orphan_id} name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            <Link
              to={detailPath}
              className="rounded text-gray-900 hover:text-trust-600 dark:text-gray-100 dark:hover:text-trust-100"
            >
              {name}
            </Link>
          </h3>
          {s.orphan_code && (
            <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {s.orphan_code}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[s.status] ?? STATUS_PILL.paused}`}
        >
          {t(`sponsorships.statuses.${s.status}`, s.status)}
        </span>
      </div>

      {sinceText && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{sinceText}</p>
      )}

      {signal && (
        <div className="rounded-xl bg-tranquil-100 px-3 py-2 text-sm text-trust-700 dark:bg-gray-700/60 dark:text-tranquil-200">
          {signal.kind === "message" ? (
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-trust-500 px-2 py-0.5 text-[11px] font-bold text-white">
                {t("donor.orphans.signal.newBadge")}
              </span>
              {t("donor.orphans.signal.newMessage", { name })}
            </span>
          ) : (
            <span>
              {t("donor.orphans.signal.reportArrived", {
                label:
                  signal.milestoneLabel ?? t("donor.orphans.signal.periodReport"),
              })}{" "}
              <span className="text-gray-500 dark:text-gray-400">
                {relativeFromNow(signal.at, lang, now)}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="mt-auto space-y-1">
        <p className="text-sm text-trust-700 dark:text-trust-100">
          {t("donor.orphans.contribution", {
            amount: formatMoney(s.total_paid, s.currency, lang),
            name,
          })}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("donor.orphans.monthlyDetail", {
            amount: formatMoney(s.monthly_amount, s.currency, lang),
          })}
        </p>
      </div>

      {s.status === "overdue" && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-700/20 dark:text-warning-100">
          {t("donor.orphans.overdueReminder", { name })}
        </p>
      )}
      {/* Regression guard: a PAUSED sponsorship never shows a next-payment
          date — it shows the paused-by-you note instead. */}
      {s.status === "paused" && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("donor.orphans.pausedNote")}
        </p>
      )}
      {s.status === "active" && s.next_payment_date && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("donor.orphans.nextPayment", {
            date: formatDate(s.next_payment_date, lang),
          })}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Link
          to={primary.to}
          className={`flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition ${primary.className}`}
        >
          {primary.label}
        </Link>
        <Link
          to={`${detailPath}?tab=media`}
          aria-label={messageLabel}
          title={messageLabel}
          className={ICON_BTN}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12Z"
              strokeLinejoin="round"
            />
          </svg>
          {card.unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -start-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-trust-500 px-1 text-[11px] font-bold text-white"
            >
              {card.unreadCount}
            </span>
          )}
        </Link>
        <Link
          to={`${detailPath}?tab=reports`}
          aria-label={profileLabel}
          title={profileLabel}
          className={ICON_BTN}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              d="M7 3h7l4 4v14H7V3Z"
              strokeLinejoin="round"
            />
            <path d="M10 12h6M10 16h6" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </article>
  );
}
