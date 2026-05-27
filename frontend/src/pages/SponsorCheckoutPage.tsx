import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { listDonors } from "@/lib/donors";
import { getOrphan } from "@/lib/orphans";
import { initiatePayment } from "@/lib/payments";

/** Donor-facing card-payment kickoff page.
 *
 * The flow:
 *   1. We pre-fetch the orphan + donors (admin path) or just the
 *      logged-in donor's record (donor path — TODO when donor auth lands).
 *   2. The donor enters an amount and currency, picks themselves from
 *      the list, hits "Pay now".
 *   3. We POST /payments/initiate, which creates a pending Payment
 *      row and calls MyFatoorah SendPayment.
 *   4. We redirect the browser to MyFatoorah's hosted page. Card data
 *      is entered there; our server never sees it.
 *   5. MyFatoorah redirects back to /payment/success or /payment/failure,
 *      which is where the donor lands after submitting.
 */
export function SponsorCheckoutPage() {
  const { t, i18n } = useTranslation();
  const { orphan_id = "" } = useParams<{ orphan_id: string }>();
  const [donorId, setDonorId] = useState("");
  const [amount, setAmount] = useState("25.00");
  const [currency, setCurrency] = useState("KWD");
  const [serverError, setServerError] = useState<string | null>(null);

  const orphanQ = useQuery({
    queryKey: ["orphan", orphan_id],
    queryFn: () => getOrphan(orphan_id),
    enabled: !!orphan_id,
  });
  const donorsQ = useQuery({
    queryKey: ["donors", { limit: 100 }],
    queryFn: () => listDonors({ limit: 100 }),
  });

  const mut = useMutation({
    mutationFn: () =>
      initiatePayment({
        donor_id: donorId,
        orphan_id,
        amount,
        currency,
        language: i18n.language === "en" ? "en" : "ar",
      }),
    onSuccess: (data) => {
      // Hand off to MyFatoorah's hosted page. Replace so the back button
      // doesn't double-fire initiate.
      window.location.replace(data.payment_url);
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  if (orphanQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (orphanQ.error || !orphanQ.data) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }
  const orphan = orphanQ.data;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/orphans" className="text-sm text-trust underline">
        ← {t("orphans.title")}
      </Link>

      <div className="card space-y-3">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("checkout.title")}
        </h1>
        <p className="text-sm text-slate-600">{t("checkout.intro")}</p>
        <div className="rounded-lg border border-sky bg-snow p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t("orphans.title")}
          </p>
          <p className="mt-1 text-lg font-semibold">
            {orphan.first_name} {orphan.family_name}
          </p>
          <p className="font-mono text-xs text-slate-500">{orphan.code}</p>
        </div>
      </div>

      <form
        className="card space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          if (!donorId || !amount || !currency) return;
          mut.mutate();
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("checkout.donor")}
          </span>
          <select
            className="input"
            value={donorId}
            onChange={(e) => setDonorId(e.target.value)}
            required
          >
            <option value="">{t("sponsorships.selectDonor")}</option>
            {donorsQ.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name} ({d.email})
              </option>
            ))}
          </select>
        </label>
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

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={mut.isPending || !donorId}
        >
          {mut.isPending ? t("checkout.redirecting") : t("checkout.payNow")}
        </button>

        <p className="text-center text-xs text-slate-500">
          {t("checkout.securityNote")}
        </p>
      </form>
    </div>
  );
}
