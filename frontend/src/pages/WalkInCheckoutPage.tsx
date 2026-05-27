import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listDonors } from "@/lib/donors";
import {
  adminInitiateOnBehalf,
  fetchPaymentReceipt,
  type PaymentInitiateResponse,
} from "@/lib/payments";

const POLL_MS = 4000;

export function WalkInCheckoutPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const donorsQ = useQuery({
    queryKey: ["donors", { limit: 100 }],
    queryFn: () => listDonors({ limit: 100 }),
  });

  const [donorId, setDonorId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("KWD");
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [result, setResult] = useState<PaymentInitiateResponse | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const initiate = useMutation({
    mutationFn: () =>
      adminInitiateOnBehalf({ donor_id: donorId, amount, currency, language }),
    onSuccess: (res) => {
      setResult(res);
      setServerError(null);
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? err.message);
      } else {
        setServerError((err as Error).message);
      }
    },
  });

  const statusQ = useQuery({
    queryKey: ["payment", result?.payment_id, "status"],
    queryFn: () => fetchPaymentReceipt(result!.payment_id),
    enabled: !!result?.payment_id,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return POLL_MS;
      return data.status === "completed" ||
        data.status === "failed" ||
        data.status === "refunded"
        ? false
        : POLL_MS;
    },
  });

  useEffect(() => {
    if (statusQ.data?.status === "completed") {
      qc.invalidateQueries({ queryKey: ["payments"] });
    }
  }, [statusQ.data?.status, qc]);

  const qrSrc = result
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(result.payment_url)}`
    : null;

  function reset() {
    setResult(null);
    setAmount("");
    setServerError(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("walkIn.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("walkIn.description")}</p>
      </div>

      {!result && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!donorId || !amount) return;
            initiate.mutate();
          }}
          className="card space-y-4"
          data-testid="walkin-form"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("walkIn.selectDonor")}
              </span>
              <select
                className="input"
                value={donorId}
                onChange={(e) => setDonorId(e.target.value)}
                data-testid="walkin-donor"
              >
                <option value="">—</option>
                {donorsQ.data?.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name} · {d.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("walkIn.amount")}
              </span>
              <input
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="walkin-amount"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("walkIn.currency")}
              </span>
              <input
                className="input"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("walkIn.language")}
              </span>
              <select
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value as "ar" | "en")}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          {serverError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {serverError}
            </p>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={initiate.isPending || !donorId || !amount}
            data-testid="walkin-submit"
          >
            {initiate.isPending ? t("walkIn.starting") : t("walkIn.start")}
          </button>
        </form>
      )}

      {result && (
        <div className="card space-y-4" data-testid="walkin-result">
          <div className="flex items-start gap-6">
            {qrSrc && (
              <img
                src={qrSrc}
                alt="QR"
                className="h-48 w-48 shrink-0 rounded border border-sky bg-white p-2"
                data-testid="walkin-qr"
              />
            )}
            <div className="flex-1 space-y-2">
              <p className="text-sm text-slate-600">{t("walkIn.qrHint")}</p>
              <a
                href={result.payment_url}
                target="_blank"
                rel="noreferrer"
                className="block break-all rounded border border-sky bg-snow px-2 py-1 font-mono text-xs text-trust"
                data-testid="walkin-link"
              >
                {result.payment_url}
              </a>
              <div className="flex gap-2">
                <a
                  href={result.payment_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary"
                >
                  {t("walkIn.openLink")}
                </a>
                <button
                  type="button"
                  className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
                  onClick={() =>
                    navigator.clipboard?.writeText(result.payment_url)
                  }
                >
                  {t("walkIn.shareLink")}
                </button>
              </div>
            </div>
          </div>

          <div
            className="rounded-lg border border-sky bg-snow p-3"
            data-testid="walkin-status"
          >
            <p className="text-sm">
              <span className="text-slate-600">{t("walkIn.status")}:</span>{" "}
              <span className="font-medium">
                {statusQ.data?.status ?? t("walkIn.polling")}
              </span>
            </p>
            {statusQ.data?.status === "completed" && (
              <p className="mt-1 text-sm text-emerald-700">
                ✓ {t("walkIn.completed")}
              </p>
            )}
            {statusQ.data?.status === "failed" && (
              <p className="mt-1 text-sm text-red-700">
                ✗ {t("walkIn.failed")}
              </p>
            )}
          </div>

          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
            onClick={reset}
          >
            {t("walkIn.newCheckout")}
          </button>
        </div>
      )}
    </div>
  );
}
