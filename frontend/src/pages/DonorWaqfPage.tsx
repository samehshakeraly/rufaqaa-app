import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { getDonorMe } from "@/lib/donorAuth";
import { formatMoney } from "@/lib/money";
import { initiatePayment, listMyPayments } from "@/lib/payments";
import { summarizeMyWaqf, validateWaqfAmount, WAQF_PRESETS } from "@/lib/waqf";

/** The currencies the gateway is configured for, as ISO codes. Codes are
 * identifiers, not copy — they read the same in ar/en/fr, so they carry
 * no translation key. */
const CURRENCIES = ["KWD", "SAR", "AED", "USD"] as const;

/** PR-W01 — the orphans waqf (/donor/waqf).
 *
 * A general donation into a SINGLE pool: no child, no sponsorship, no
 * new model — just `POST /payments/initiate` with `target_type: "waqf"`.
 *
 * What this page deliberately does NOT show: the size of the pool, its
 * yield, or how that yield is distributed. The system holds none of
 * those numbers, and an invented figure in front of a donor is worse
 * than no figure. The one waqf number here is the donor's OWN
 * contribution, derived from the payments the portal already loads.
 *
 * Nor is there a one-time/monthly toggle: recurring payments do not
 * exist in the system yet, and the UI never promises what the backend
 * cannot honour. */
export function DonorWaqfPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { isDonor } = useRole();

  const [amount, setAmount] = useState<string>(String(WAQF_PRESETS[0] ?? 10));
  const [currency, setCurrency] = useState<string>(CURRENCIES[0]);

  // Donor-scoped endpoints 403 for any other role. DonorRoute already
  // redirects staff away; gating on role too means a donor-only request
  // can never fire during a role transition.
  const meQ = useQuery({
    queryKey: ["donor", "me"],
    queryFn: getDonorMe,
    enabled: isDonor,
  });
  // "My contribution" is a progressive enhancement: if this fetch fails
  // the card simply doesn't render — it never blocks giving.
  const paymentsQ = useQuery({
    queryKey: ["donor", "me", "payments", { surface: "waqf" }],
    queryFn: () => listMyPayments({ limit: 100 }),
    enabled: isDonor,
    retry: false,
  });

  const mine = useMemo(
    () => (paymentsQ.data ? summarizeMyWaqf(paymentsQ.data.items) : null),
    [paymentsQ.data],
  );

  const parsed = validateWaqfAmount(amount);

  const mut = useMutation({
    mutationFn: () => {
      const donor = meQ.data;
      if (!donor) throw new Error("donor profile not loaded");
      const valid = validateWaqfAmount(amount);
      if (!valid.ok) throw new Error(`invalid amount: ${valid.reason}`);
      return initiatePayment({
        donor_id: donor.id,
        amount: valid.value,
        currency,
        language: lang === "en" ? "en" : "ar",
        target_type: "waqf",
      });
    },
    onSuccess: (data) => {
      window.location.replace(data.payment_url);
    },
  });

  if (meQ.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // The donor's own profile is the one hard dependency: without its id
  // no payment can be initiated at all.
  if (!meQ.data) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Header />
        <FailureCard
          message={t("donor.waqf.error")}
          actionLabel={t("donor.waqf.retry")}
          onAction={() => void meQ.refetch()}
        />
      </div>
    );
  }

  const donor = meQ.data;
  const gatewayError =
    mut.error instanceof AxiosError
      ? (mut.error.response?.data?.detail ?? null)
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Header />

      {mine && (
        <section
          aria-label={t("donor.waqf.mineTitle")}
          className="card space-y-1 p-5"
        >
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
            {t("donor.waqf.mineTitle")}
          </h2>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("donor.waqf.mineTotal", {
              amount: formatMoney(mine.total, mine.currency, lang),
            })}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("donor.waqf.mineCount", { count: mine.count })}
            {mine.otherCurrenciesCount > 0 && (
              <>
                {" · "}
                {t("donor.waqf.otherCurrencies", {
                  count: mine.otherCurrenciesCount,
                })}
              </>
            )}
          </p>
        </section>
      )}

      <form
        className="card space-y-5 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed.ok) return;
          mut.mutate();
        }}
      >
        <div
          role="group"
          aria-label={t("donor.waqf.amount")}
          className="flex flex-wrap gap-2"
        >
          {WAQF_PRESETS.map((preset) => {
            const selected = parsed.ok && Number(parsed.value) === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => setAmount(String(preset))}
                className={`min-h-[44px] rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  selected
                    ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {formatMoney(preset, currency, lang)}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("donor.waqf.customAmount")}
            </span>
            <input
              className="input min-h-[44px]"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("donor.waqf.currency")}
            </span>
            <select
              className="input min-h-[44px]"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("donor.waqf.payingAs", {
            name: donor.full_name,
            email: donor.email,
          })}
        </p>

        <button
          type="submit"
          className="btn-primary min-h-[44px] w-full"
          disabled={!parsed.ok || mut.isPending}
        >
          {t("donor.waqf.submit", {
            amount: parsed.ok
              ? formatMoney(parsed.value, currency, lang)
              : formatMoney(Number.NaN, currency, lang),
          })}
        </button>

        {/* Fixed, never conditional: the waqf holds the asset itself and
            never transfers ownership to the recipient, while zakat is a
            transfer of ownership — so zakat cannot be paid here. The
            zakat track never links to this page either. */}
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {t("donor.waqf.notZakat")}
        </p>

        {mut.isError && (
          <FailureCard
            message={gatewayError ? String(gatewayError) : t("donor.waqf.error")}
            actionLabel={t("donor.waqf.retry")}
            onAction={() => mut.mutate()}
          />
        )}
      </form>
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <header className="space-y-3">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {t("donor.waqf.title")}
      </h1>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t("donor.waqf.lead")}
      </p>
      <blockquote className="border-s-2 border-gray-300 ps-3 text-sm italic text-gray-700 dark:border-gray-600 dark:text-gray-200">
        {t("donor.waqf.hadith")}
      </blockquote>
      <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {t("donor.waqf.body")}
      </p>
    </header>
  );
}

/** Every failure state on this page: a sentence the donor can act on,
 * plus the action itself. Never a bare description, and never `danger`
 * — a payment that didn't start is a setback, not an alarm. */
function FailureCard({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-warning-500/40 bg-warning-50 p-4 dark:bg-warning-500/10"
    >
      <p className="text-sm text-gray-700 dark:text-gray-200">{message}</p>
      <button type="button" onClick={onAction} className="btn-primary min-h-[44px]">
        {actionLabel}
      </button>
    </div>
  );
}
