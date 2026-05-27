import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { fetchPaymentReceipt } from "@/lib/payments";

export function PaymentReceiptPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["payment-receipt", id],
    queryFn: () => fetchPaymentReceipt(id),
    enabled: !!id,
  });

  if (isLoading) {
    return <p className="p-8 text-slate-500">{t("common.loading")}</p>;
  }
  if (error || !data) {
    return (
      <p className="p-8 text-red-700">
        {t("common.loadError")}
      </p>
    );
  }

  const completed = data.completed_at
    ? new Date(data.completed_at).toLocaleString(i18n.language, {
        dateStyle: "long",
        timeStyle: "short",
      })
    : "—";
  const orgName =
    i18n.language === "ar"
      ? data.organization_name_ar
      : data.organization_name_en ?? data.organization_name_ar;
  const amount = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(data.amount));

  return (
    <div className="receipt-page mx-auto max-w-2xl bg-white p-8 text-slate-900">
      <div className="print:hidden mb-4 flex items-center justify-between">
        <Link to="/payments" className="text-sm text-trust underline">
          ← {t("receipt.back")}
        </Link>
        <button
          type="button"
          className="btn-primary"
          onClick={() => window.print()}
        >
          {t("receipt.print")}
        </button>
      </div>

      <article className="rounded-lg border border-sky bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <header className="border-b border-sky pb-4">
          <h1 className="text-2xl font-bold text-trust">{orgName}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("receipt.title")}</p>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <Row label={t("receipt.code")} value={data.payment_code} mono />
          <Row label={t("receipt.completedAt")} value={completed} />
          <Row label={t("receipt.donor")} value={data.donor_name} />
          <Row label={t("receipt.donorCode")} value={data.donor_code} mono />
          {data.donor_email && (
            <Row label={t("receipt.donorEmail")} value={data.donor_email} />
          )}
          {data.orphan_name && (
            <Row label={t("receipt.orphan")} value={data.orphan_name} />
          )}
          {data.orphan_code && (
            <Row label={t("receipt.orphanCode")} value={data.orphan_code} mono />
          )}
          {data.sponsorship_code && (
            <Row
              label={t("receipt.sponsorshipCode")}
              value={data.sponsorship_code}
              mono
            />
          )}
          <Row
            label={t("receipt.paymentMethod")}
            value={t(`payments.methods.${data.payment_method}`, data.payment_method)}
          />
          <Row
            label={t("receipt.status")}
            value={t(`payments.statuses.${data.status}`, data.status)}
          />
        </section>

        <section className="mt-8 rounded-lg bg-tranquil/40 p-6 text-center">
          <p className="text-sm text-slate-600">{t("receipt.amount")}</p>
          <p className="mt-2 text-4xl font-bold text-trust">
            {amount} <span className="text-2xl text-slate-700">{data.currency}</span>
          </p>
        </section>

        <footer className="mt-8 border-t border-sky pt-4 text-center text-xs text-slate-500">
          <p>{t("receipt.thanks")}</p>
          <p className="mt-1 font-mono">
            {data.payment_id}
          </p>
        </footer>
      </article>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 ${mono ? "font-mono text-xs" : "text-sm"} text-slate-900`}>
        {value}
      </dd>
    </div>
  );
}
