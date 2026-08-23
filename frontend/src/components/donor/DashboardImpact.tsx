import { useTranslation } from "react-i18next";

import type { YearToDate } from "@/lib/donorDashboard";
import type { ImpactSummary } from "@/lib/donorOrphans";
import type { PaymentRow } from "@/lib/donorPayments";
import { buildStatementCsv } from "@/lib/donorPayments";
import { formatDuration, humanDuration } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/** PR-D01 — the full-width gradient "what your giving adds up to" strip.
 *
 * All three cells are client-side aggregates. Amounts in different
 * currencies are NEVER summed: each cell shows the dominant currency
 * through `formatMoney` with a "+n other currencies" note. The
 * year-statement button reuses the PR-D08 CSV builder with the exact
 * same labels — same file, wherever the donor exports it from. */
export function DashboardImpact({
  summary,
  activeCount,
  ytd,
  year,
  statementRows,
}: {
  summary: ImpactSummary;
  /** Live sponsorships with status === "active". */
  activeCount: number;
  ytd: YearToDate | null;
  year: number;
  /** This year's payment rows for the CSV export — null while payments
   * are unavailable, which also hides the export button. */
  statementRows: PaymentRow[] | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const duration = summary.earliestStart
    ? humanDuration(summary.earliestStart)
    : null;
  const opener = duration
    ? t("donor.dashboard.impact.opener", {
        count: summary.childrenCount,
        duration: formatDuration(duration, t),
      })
    : t("donor.dashboard.impact.openerNoDuration", {
        count: summary.childrenCount,
      });

  const othersNote = (n: number) =>
    n > 0 ? ` ${t("donor.dashboard.impact.otherCurrencies", { count: n })}` : "";

  const exportCsv = () => {
    if (!statementRows) return;
    const csv = buildStatementCsv(statementRows, {
      headers: [
        t("donor.payments.csv.date"),
        t("donor.payments.csv.code"),
        t("donor.payments.csv.about"),
        t("donor.payments.csv.amount"),
        t("donor.payments.csv.currency"),
        t("donor.payments.csv.method"),
        t("donor.payments.csv.status"),
        t("donor.payments.csv.receiptNumber"),
        t("donor.payments.csv.bankReference"),
        t("donor.payments.csv.gatewayTransactionId"),
      ],
      generalDonation: t("donor.payments.table.generalDonation"),
      waqfDonation: t("donor.payments.table.waqfDonation"),
      sponsorshipOf: (name) => t("donor.payments.table.sponsorshipOf", { name }),
      donationFor: (name) => t("donor.payments.table.donationFor", { name }),
      methodLabel: (m) => t(`payments.methods.${m}`, m),
      statusLabel: (s) => t(`donor.payments.statuses.${s}`),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rufaqaa-statement-${year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label={t("donor.dashboard.impact.ariaLabel")}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-bl from-trust-600 via-trust-400 to-trust-300 p-6 text-white shadow-md dark:from-trust-900 dark:via-trust-700 dark:to-trust-600"
    >
      <p className="text-base font-semibold">{opener}</p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-white/80">
            {t("donor.dashboard.impact.totalGiven")}
          </dt>
          <dd className="mt-1 text-lg font-bold">
            {summary.dominant.totalPaid > 0 ? (
              <>
                {formatMoney(
                  summary.dominant.totalPaid,
                  summary.dominant.currency,
                  lang,
                )}
                {othersNote(summary.otherCurrenciesCount)}
                {summary.paymentsCount > 0 && (
                  <span className="block text-xs font-normal text-white/75">
                    {t("donor.dashboard.impact.paymentsCount", {
                      count: summary.paymentsCount,
                    })}
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm font-medium">
                {t("donor.dashboard.impact.justStarted")}
              </span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-white/80">
            {t("donor.dashboard.impact.monthly")}
          </dt>
          <dd className="mt-1 text-lg font-bold">
            {formatMoney(
              summary.dominant.monthlyActive,
              summary.dominant.currency,
              lang,
            )}
            {othersNote(summary.otherCurrenciesCount)}
            <span className="block text-xs font-normal text-white/75">
              {t("donor.dashboard.impact.monthlySub", { count: activeCount })}
            </span>
          </dd>
        </div>

        <div>
          <dt className="text-xs font-medium text-white/80">
            {ytd
              ? t("donor.dashboard.impact.thisYear", { year: ytd.year })
              : t("donor.dashboard.impact.thisYearGeneric")}
          </dt>
          <dd className="mt-1 text-lg font-bold">
            {ytd ? (
              <>
                {formatMoney(ytd.total, ytd.currency, lang)}
                {othersNote(ytd.otherCurrenciesCount)}
                <span className="block text-xs font-normal text-white/75">
                  {t("donor.dashboard.impact.paymentsCount", {
                    count: ytd.count,
                  })}
                </span>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      {statementRows && (
        <button
          type="button"
          onClick={exportCsv}
          className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-trust-700 transition hover:bg-tranquil-100"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12M8 11l4 4 4-4M4 20h16" />
          </svg>
          {t("donor.dashboard.impact.statement", { year })}
        </button>
      )}
    </section>
  );
}
