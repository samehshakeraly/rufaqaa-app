import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { OrphanAvatar } from "@/components/donor/OrphanAvatar";
import { daysUntil } from "@/lib/donorDashboard";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { Sponsorship } from "@/lib/sponsorships";

/** PR-D01 — the one upcoming charge (active sponsorships only — see
 * `nextScheduledPayment`). With nothing scheduled the card STAYS, with
 * a calm "no scheduled payments" line: a card that vanishes reads as a
 * bug, not as good news. */
export function NextPaymentCard({
  sponsorship,
  now,
}: {
  sponsorship: Sponsorship | null;
  now: Date;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const days = sponsorship?.next_payment_date
    ? daysUntil(sponsorship.next_payment_date, now)
    : null;

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
        {t("donor.dashboard.next.title")}
      </h2>

      {sponsorship ? (
        <>
          <p className="text-2xl font-bold text-trust-700 dark:text-trust-100">
            {formatMoney(sponsorship.monthly_amount, sponsorship.currency, lang)}
          </p>
          {sponsorship.next_payment_date && days !== null && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("donor.dashboard.next.due", {
                count: days,
                date: formatDate(sponsorship.next_payment_date, lang),
              })}
            </p>
          )}
          <div className="flex items-center gap-2.5">
            <OrphanAvatar
              orphanId={sponsorship.orphan_id}
              name={sponsorship.orphan_name ?? "—"}
              size="sm"
            />
            <p className="text-sm text-gray-700 dark:text-gray-200">
              {t("donor.dashboard.next.forChild", {
                name: sponsorship.orphan_name ?? "—",
              })}
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("donor.dashboard.next.none")}
        </p>
      )}

      <Link
        to="/donor/payments"
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-trust-700 shadow-sm transition hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-trust-100 dark:hover:bg-gray-700"
      >
        {t("donor.dashboard.next.viewAll")}
      </Link>
    </section>
  );
}
