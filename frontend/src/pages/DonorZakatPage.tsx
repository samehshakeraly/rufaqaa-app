import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { getDonorMe } from "@/lib/donorAuth";
import { formatMoney } from "@/lib/money";
import { initiatePayment } from "@/lib/payments";
import {
  computeZakat,
  NISAB_GOLD_GRAMS,
  parseAmount,
  toPaymentAmount,
  ZAKAT_RATE,
  type ZakatInput,
} from "@/lib/zakat";

/** The currencies the gateway is configured for, as ISO codes. Codes are
 * identifiers, not copy — they read the same in ar/en/fr, so they carry
 * no translation key. */
const CURRENCIES = ["KWD", "SAR", "AED", "USD"] as const;

const EMPTY_INPUT: ZakatInput = {
  cash: "",
  goldGrams: "",
  goldPricePerGram: "",
  silverGrams: "",
  silverPricePerGram: "",
  tradeGoods: "",
  receivables: "",
  debts: "",
};

/** Form order. The list is data the page maps over, not copy — each key
 * resolves to its label through `donor.zakat.fields.*`. */
const FIELD_ORDER: readonly (keyof ZakatInput)[] = [
  "cash",
  "goldGrams",
  "goldPricePerGram",
  "silverGrams",
  "silverPricePerGram",
  "tradeGoods",
  "receivables",
  "debts",
];

/** PR-Z01 — the simplified zakat calculator (/donor/zakat).
 *
 * Three constraints govern this page and must survive every edit:
 *
 * 1. Rufaqaa issues no religious rulings. The math (in `lib/zakat.ts`)
 *    applies the well-known position only, and a FIXED box states that
 *    schools of law differ and the estimate is the donor's own
 *    responsibility. There is no lunar-year computation — the system
 *    does not know when the wealth was acquired, so the condition is
 *    stated in copy, never calculated.
 * 2. Zakat never flows into the waqf. The outlet here leads to orphans
 *    only — pay (`target_type: "zakat"`, no child attached) or go
 *    sponsor. No link to /donor/waqf may ever appear on this page.
 * 3. No zakat badge on any child. The eligibility field does not exist
 *    yet, so no filter and no badge — a short card says why, in
 *    language that protects the child's dignity.
 *
 * The gold price is typed by the donor: the system has no price source
 * and fetches none. */
export function DonorZakatPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { isDonor } = useRole();

  const [input, setInput] = useState<ZakatInput>(EMPTY_INPUT);
  // null = the donor has not touched the amount; it follows `due`.
  const [amountOverride, setAmountOverride] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [currency, setCurrency] = useState<string>(CURRENCIES[0]);

  // Donor-scoped endpoints 403 for any other role. DonorRoute already
  // redirects staff away; gating on role too means a donor-only request
  // can never fire during a role transition. The calculator itself has
  // no server dependency — only the payment section needs the profile,
  // so a failed fetch degrades to a retry card there, never a blank page.
  const meQ = useQuery({
    queryKey: ["donor", "me"],
    queryFn: getDonorMe,
    enabled: isDonor,
  });

  const result = useMemo(() => computeZakat(input), [input]);
  const invalid = new Set<keyof ZakatInput>(result.ok ? [] : result.invalidFields);

  const amountValue =
    amountOverride ?? (result.ok && result.reachesNisab ? toPaymentAmount(result.due) : "");
  const parsedAmount = parseAmount(amountValue);
  const amountOk = parsedAmount !== null && parsedAmount > 0;

  const mut = useMutation({
    mutationFn: () => {
      const donor = meQ.data;
      if (!donor) throw new Error("donor profile not loaded");
      if (parsedAmount === null || parsedAmount <= 0)
        throw new Error("invalid zakat amount");
      return initiatePayment({
        donor_id: donor.id,
        amount: toPaymentAmount(parsedAmount),
        currency,
        language: lang === "en" ? "en" : "ar",
        target_type: "zakat",
      });
    },
    onSuccess: (data) => {
      window.location.replace(data.payment_url);
    },
  });
  const gatewayError =
    mut.error instanceof AxiosError
      ? (mut.error.response?.data?.detail ?? null)
      : null;

  const setField = (field: keyof ZakatInput) => (value: string) =>
    setInput((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("donor.zakat.title")}
        </h1>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          {t("donor.zakat.lead")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Form column ─────────────────────────────────────────── */}
        <section aria-label={t("donor.zakat.compute")} className="space-y-4">
          <form className="card space-y-4 p-5" onSubmit={(e) => e.preventDefault()}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("donor.zakat.compute")}
            </h2>
            {FIELD_ORDER.map((field) => (
              <AmountField
                key={field}
                id={`zakat-${field}`}
                label={t(`donor.zakat.fields.${field}`)}
                value={input[field]}
                invalid={invalid.has(field)}
                invalidMessage={t("donor.zakat.invalidNumber")}
                onChange={setField(field)}
              />
            ))}
          </form>

          {/* Fixed, never conditional: the platform's limits. */}
          <div className="card space-y-1 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t("donor.zakat.limitsTitle")}
            </h2>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {t("donor.zakat.limitsBody", {
                grams: NISAB_GOLD_GRAMS,
                rate: ZAKAT_RATE * 100,
              })}
            </p>
          </div>
        </section>

        {/* ── Result column ───────────────────────────────────────── */}
        <section aria-label={t("donor.zakat.due")} className="space-y-4">
          {result.ok && (
            <div className="card space-y-4 p-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                  {t("donor.zakat.base")}
                </h2>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatMoney(result.base, currency, lang)}
                </p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                  {t("donor.zakat.due")}
                </h2>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {formatMoney(result.due, currency, lang)}
                </p>
              </div>
              {/* Neutral, warning-toned, never danger: being below the
                  nisab is simply a fact about the estimate, not an alarm. */}
              {result.reachesNisab ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {t("donor.zakat.nisabReached")}
                </p>
              ) : (
                <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
                  {t("donor.zakat.nisabNotReached", {
                    nisab: formatMoney(result.nisabValue, currency, lang),
                  })}
                </p>
              )}
            </div>
          )}

          {/* The whole payment section exists only once the nisab is
              reached — never a disabled button for a donor who owes
              nothing. */}
          {result.ok && result.reachesNisab && (
            <div className="card space-y-4 p-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t("donor.zakat.directTitle")}
              </h2>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {t("donor.zakat.directBody")}
              </p>

              {meQ.isLoading && <Skeleton className="h-32 w-full rounded-xl" />}

              {meQ.isError && (
                <FailureCard
                  message={t("donor.zakat.error")}
                  actionLabel={t("donor.zakat.retry")}
                  onAction={() => void meQ.refetch()}
                />
              )}

              {meQ.data && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                        {t("donor.zakat.amount")}
                      </span>
                      <input
                        className="input min-h-[44px]"
                        inputMode="decimal"
                        value={amountValue}
                        onChange={(e) => setAmountOverride(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                        {t("donor.zakat.currency")}
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

                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    <span className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                      {t("donor.zakat.ack")}
                    </span>
                  </label>

                  <button
                    type="button"
                    className="btn-primary min-h-[44px] w-full"
                    disabled={!acknowledged || !amountOk || mut.isPending}
                    onClick={() => mut.mutate()}
                  >
                    {t("donor.zakat.pay", {
                      amount: amountOk
                        ? formatMoney(parsedAmount, currency, lang)
                        : formatMoney(Number.NaN, currency, lang),
                    })}
                  </button>

                  {mut.isError && (
                    <FailureCard
                      message={
                        gatewayError ? String(gatewayError) : t("donor.zakat.error")
                      }
                      actionLabel={t("donor.zakat.retry")}
                      onAction={() => mut.mutate()}
                    />
                  )}
                </>
              )}

              <Link
                to="/orphans"
                className="btn-secondary block min-h-[44px] w-full text-center"
              >
                {t("donor.zakat.orSponsor")}
              </Link>
            </div>
          )}

          {/* Why no child carries a zakat badge: the eligibility data
              does not exist yet, and a need is never pinned on a child. */}
          <div className="card space-y-1 p-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t("donor.zakat.whyNoBadgeTitle")}
            </h2>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {t("donor.zakat.whyNoBadgeBody")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/** One typed amount. Empty is fine (it means zero); only a non-numeric
 * or negative value marks the field, with the message tied to the input
 * for screen readers. */
function AmountField({
  id,
  label,
  value,
  invalid,
  invalidMessage,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  invalidMessage: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        {label}
      </label>
      <input
        id={id}
        className="input min-h-[44px]"
        inputMode="decimal"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && (
        <p id={`${id}-error`} className="mt-1 text-xs text-warning-700 dark:text-warning-500">
          {invalidMessage}
        </p>
      )}
    </div>
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
