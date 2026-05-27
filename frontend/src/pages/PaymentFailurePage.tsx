import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

/** MyFatoorah redirects here on a card decline / cancel / timeout. */
export function PaymentFailurePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  // The orphan ID isn't carried back by MyFatoorah, but the donor can
  // navigate from /orphans to retry. We only know the (failed)
  // payment_id, which is useful for the audit reference.
  const paymentId = params.get("payment_id");

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="card space-y-4 text-center">
        <div className="text-5xl">⚠️</div>
        <h1 className="text-2xl font-bold text-red-700">
          {t("paymentFailure.title")}
        </h1>
        <p className="text-sm text-slate-600">{t("paymentFailure.body")}</p>
        {paymentId && (
          <p className="font-mono text-xs text-slate-500">
            ref: {paymentId.slice(0, 8)}
          </p>
        )}
        <div className="flex flex-col gap-2 pt-2">
          <Link to="/orphans" className="btn-primary block">
            {t("paymentFailure.tryAgain")}
          </Link>
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
