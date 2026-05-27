import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { getDonorMe } from "@/lib/donorAuth";
import { initiatePayment } from "@/lib/payments";
import { getPublicOrphan } from "@/lib/public";

/** Donor-facing card-payment kickoff page.
 *
 * Route: /sponsor/:code/checkout (public orphan code, not internal UUID).
 *
 * The flow:
 *   1. Pre-fetch the orphan via the public endpoint (anon-safe shape).
 *   2. Pre-fetch the logged-in donor's own profile — no dropdown.
 *   3. The donor enters an amount and currency, hits "Pay now".
 *   4. POST /payments/initiate — the backend enforces donor ownership +
 *      email verification.
 *   5. Browser redirects to MyFatoorah's hosted page. Card data is
 *      entered there; our server never sees it.
 *   6. MyFatoorah redirects back to /payment/success or
 *      /payment/failure on completion.
 */
export function SponsorCheckoutPage() {
  const { t, i18n } = useTranslation();
  const { code = "" } = useParams<{ code: string }>();
  const [amount, setAmount] = useState("25.00");
  const [currency, setCurrency] = useState("KWD");
  const [serverError, setServerError] = useState<string | null>(null);

  const orphanQ = useQuery({
    queryKey: ["public", "orphan", code],
    queryFn: () => getPublicOrphan(code),
    enabled: !!code,
  });
  const meQ = useQuery({
    queryKey: ["donor", "me"],
    queryFn: getDonorMe,
  });

  const mut = useMutation({
    mutationFn: () => {
      if (!meQ.data) throw new Error("donor profile not loaded");
      return initiatePayment({
        donor_id: meQ.data.id,
        amount,
        currency,
        language: i18n.language === "en" ? "en" : "ar",
      });
    },
    onSuccess: (data) => {
      window.location.replace(data.payment_url);
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? t("common.createError")
          : t("common.createError");
      setServerError(String(msg));
    },
  });

  if (orphanQ.isLoading || meQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (orphanQ.error || !orphanQ.data || !meQ.data) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }
  const orphan = orphanQ.data;
  const donor = meQ.data;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/orphans" className="text-sm text-trust underline">
        ← {t("public.orphans.title")}
      </Link>

      <div className="card space-y-3">
        <h1 className="text-2xl font-bold text-slate-900">{t("checkout.title")}</h1>
        <p className="text-sm text-slate-600">{t("checkout.intro")}</p>
        <div className="rounded-lg border border-sky bg-snow p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t("public.orphans.title")}
          </p>
          <p className="mt-1 text-lg font-semibold">{orphan.first_name}</p>
          <p className="font-mono text-xs text-slate-500">{orphan.code}</p>
        </div>
      </div>

      <form
        className="card space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          if (!amount || !currency) return;
          mut.mutate();
        }}
      >
        <div className="rounded-lg bg-tranquil/40 px-3 py-2 text-sm text-trust">
          {t("checkout.payingAs", {
            name: donor.full_name,
            email: donor.email,
          })}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t("checkout.amount")}
            </span>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t("checkout.currency")}
            </span>
            <input
              className="input"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              required
            />
          </label>
        </div>

        {serverError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={mut.isPending}>
          {mut.isPending ? t("checkout.redirecting") : t("checkout.payNow")}
        </button>

        <p className="text-center text-xs text-slate-500">
          {t("checkout.securityNote")}
        </p>
      </form>
    </div>
  );
}
