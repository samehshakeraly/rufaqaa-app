import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

/** MyFatoorah redirects the donor here on a successful charge. The
 * actual payment activation happens in the webhook handler; this page
 * is purely a UX confirmation + a way back into the app. */
export function PaymentSuccessPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const paymentId = params.get("payment_id");

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="card space-y-4 text-center">
        <div className="text-5xl">✅</div>
        <h1 className="text-2xl font-bold text-emerald-700">
          {t("paymentSuccess.title")}
        </h1>
        <p className="text-sm text-slate-600">{t("paymentSuccess.body")}</p>
        <div className="flex flex-col gap-2 pt-2">
          {paymentId && (
            <Link
              to={`/payments/${paymentId}/receipt`}
              className="btn-primary block"
            >
              {t("paymentSuccess.downloadReceipt")}
            </Link>
          )}
          <Link
            to="/dashboard"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil"
          >
            {t("paymentSuccess.backToDashboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}
