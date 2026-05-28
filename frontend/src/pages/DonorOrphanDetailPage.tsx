import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { listMyDonorSponsorships } from "@/lib/donorAuth";
import { getPublicOrphan } from "@/lib/public";

/**
 * D-07 — donor-scoped post-sponsorship orphan view.
 *
 * Reachable only via DonorLayout (no admin chrome). Renders sponsorship
 * progress and report history for an orphan the current donor is already
 * sponsoring. Honours business_rules: no internal financial data, no
 * partner identity, no photos of real children.
 */
export function DonorOrphanDetailPage() {
  const { t } = useTranslation();
  const { code = "" } = useParams<{ code: string }>();

  const orphanQ = useQuery({
    queryKey: ["public", "orphan", code],
    queryFn: () => getPublicOrphan(code),
    enabled: !!code,
  });

  const sponsorshipsQ = useQuery({
    queryKey: ["donor", "me", "sponsorships"],
    queryFn: listMyDonorSponsorships,
  });

  if (orphanQ.isLoading || sponsorshipsQ.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (orphanQ.error || !orphanQ.data) {
    return (
      <p
        role="alert"
        className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700"
      >
        {t("common.loadError")}
      </p>
    );
  }

  const orphan = orphanQ.data;
  const sponsorship = sponsorshipsQ.data?.find(
    (s) => s.orphan_code === orphan.code,
  );

  // Donor isn't sponsoring this orphan — bounce them back to their list
  // instead of leaking the staff orphan-detail page.
  if (!sponsorship) {
    return <Navigate to="/donor/sponsorships" replace />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/donor/sponsorships"
        className="text-sm text-trust-700 underline"
      >
        ← {t("donor.sponsorships.title")}
      </Link>

      {/* Hero: orphan identity (no photo, no partner identity) */}
      <article className="card space-y-3">
        <p className="font-mono text-xs tabular-nums text-gray-500">
          {orphan.code}
        </p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {orphan.first_name}
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          {t("public.orphans.age", { age: orphan.age_years })} ·{" "}
          {orphan.gender === "M"
            ? t("orphans.male")
            : t("orphans.female")}
          {orphan.country ? ` · ${orphan.country}` : ""}
        </p>
        {orphan.short_description && (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            {orphan.short_description}
          </p>
        )}
        {/* business_rules: no partner_organization_name shown to donors */}
      </article>

      {/* Sponsorship progress */}
      <section
        aria-labelledby="progress-heading"
        className="card space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2
            id="progress-heading"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t("donor.orphanDetail.progress")}
          </h2>
          <span className="font-mono text-xs tabular-nums text-gray-500">
            {sponsorship.code}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProgressStat
            label={t("donor.orphanDetail.monthlyAmount")}
            value={sponsorship.monthly_amount}
            unit={sponsorship.currency}
          />
          <ProgressStat
            label={t("donor.orphanDetail.totalPaid")}
            value={sponsorship.total_paid}
            unit={sponsorship.currency}
          />
          <ProgressStat
            label={t("donor.orphanDetail.startedOn")}
            value={sponsorship.start_date ?? "—"}
          />
          <ProgressStat
            label={t("donor.orphanDetail.status")}
            value={t(
              `sponsorships.statuses.${sponsorship.status}`,
              sponsorship.status,
            )}
          />
        </div>
      </section>

      {/* Reports — TODO(backend): donor-scoped report listing */}
      <section
        aria-labelledby="reports-heading"
        className="card space-y-3"
      >
        <h2
          id="reports-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("donor.orphanDetail.reports")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("donor.orphanDetail.reportsDescription")}
        </p>
        {/* TODO(backend): wire to GET /donor/me/sponsorships/{id}/reports
            (or expose orphan UUID + allow /reports?orphan_id=…&status=
            published_to_donor for donor sessions). Until that lands the
            donor cannot list published reports for the orphan they sponsor. */}
        <p
          role="status"
          className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700"
        >
          {t("donor.orphanDetail.reportsTodo")}
        </p>
      </section>

      {/* Payments — TODO(backend): per-sponsorship payment filter */}
      <section
        aria-labelledby="payments-heading"
        className="card space-y-3"
      >
        <h2
          id="payments-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("donor.orphanDetail.payments")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("donor.orphanDetail.paymentsDescription")}
        </p>
        {/* TODO(backend): extend /donor/me/payments with a sponsorship_id
            filter (or include sponsorship_id on DonorPaymentMini) so the
            donor can see only this sponsorship's payments. */}
        <p
          role="status"
          className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700"
        >
          {t("donor.orphanDetail.paymentsTodo")}
        </p>
      </section>
    </div>
  );
}

function ProgressStat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="panel">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
        {unit && (
          <span className="ms-1 text-sm font-normal text-gray-500">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
