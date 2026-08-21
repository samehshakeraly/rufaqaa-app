import { useTranslation } from "react-i18next";

import type { ImpactSummary } from "@/lib/donorOrphans";
import { formatDate, formatDuration, humanDuration } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/** PR-D06 — the page's opening "what your care adds up to" strip.
 *
 * Everything is computed client-side from the live sponsorships (see
 * `summarizeImpact`). Amounts in different currencies are never summed:
 * the dominant currency is shown, with a "+n other currencies" note. */
export function ImpactBar({ summary }: { summary: ImpactSummary }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const duration = summary.earliestStart
    ? humanDuration(summary.earliestStart)
    : null;
  const opener = duration
    ? t("donor.orphans.impact.opener", {
        n: summary.childrenCount,
        duration: formatDuration(duration, t),
      })
    : t("donor.orphans.impact.openerNoDuration", {
        n: summary.childrenCount,
      });

  const othersNote =
    summary.otherCurrenciesCount > 0
      ? ` ${t("donor.orphans.impact.otherCurrencies", {
          n: summary.otherCurrenciesCount,
        })}`
      : "";

  const totalCell =
    summary.dominant.totalPaid > 0
      ? `${formatMoney(summary.dominant.totalPaid, summary.dominant.currency, lang)}${othersNote}`
      : t("donor.orphans.impact.justStarted");

  return (
    <section
      aria-label={t("donor.orphans.impact.ariaLabel")}
      className="card space-y-4 p-5"
    >
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
        {opener}
      </p>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">
            {t("donor.orphans.impact.totalGiven")}
          </dt>
          <dd className="mt-1 text-sm font-medium text-trust-700 dark:text-trust-100">
            {totalCell}
            {summary.paymentsCount > 0 && (
              <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                {t("donor.orphans.impact.paymentsCount", {
                  n: summary.paymentsCount,
                })}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">
            {t("donor.orphans.impact.monthlyCommitment")}
          </dt>
          <dd className="mt-1 text-sm font-medium text-trust-700 dark:text-trust-100">
            {formatMoney(
              summary.dominant.monthlyActive,
              summary.dominant.currency,
              lang,
            )}
            {othersNote}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 dark:text-gray-400">
            {t("donor.orphans.impact.nextPayment")}
          </dt>
          <dd className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200">
            {summary.nextPayment
              ? t("donor.orphans.impact.nextPaymentValue", {
                  date: formatDate(summary.nextPayment.date, lang),
                  name: summary.nextPayment.orphanName ?? "—",
                })
              : t("donor.orphans.impact.noScheduledPayments")}
          </dd>
        </div>
      </dl>
    </section>
  );
}
