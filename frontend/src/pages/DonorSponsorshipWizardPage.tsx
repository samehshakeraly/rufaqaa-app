import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { Skeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { createMyDonorSponsorship, getDonorMe } from "@/lib/donorAuth";
import { getPublicOrphan } from "@/lib/public";
import { toast } from "@/store/toasts";

const FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "one_time",
] as const;
type Frequency = (typeof FREQUENCIES)[number];

const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/)
  .refine((v) => Number(v) > 0);
const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/);

/** D-04 — multi-step wizard for an authenticated donor sponsoring a
 * specific orphan (by public code).
 *
 * Steps: (1) orphan summary, (2) amount + frequency + currency,
 * (3) review + confirm → POST /donor/me/sponsorships.
 *
 * The optional-message step from the mockup is intentionally omitted in
 * this phase — donor messaging compose is deferred until the backend can
 * auto-resolve a recipient (see PR description). */
export function DonorSponsorshipWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { code = "" } = useParams<{ code: string }>();
  const { isDonor } = useRole();

  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("25.00");
  const [currency, setCurrency] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const orphanQ = useQuery({
    queryKey: ["public", "orphan", code],
    queryFn: () => getPublicOrphan(code),
    enabled: !!code,
  });
  // Donor-only endpoint — gate on role (defence-in-depth alongside
  // DonorRoute) so it can never 403 for a non-donor.
  const meQ = useQuery({
    queryKey: ["donor", "me"],
    queryFn: getDonorMe,
    enabled: isDonor,
  });

  // Seed the currency from the donor's preference once it loads.
  const preferredCurrency = meQ.data?.preferred_currency ?? "KWD";
  const effectiveCurrency = currency || preferredCurrency;

  const mut = useMutation({
    mutationFn: () =>
      createMyDonorSponsorship({
        orphan_code: code,
        monthly_amount: amountSchema.parse(amount),
        currency: currencySchema.parse(effectiveCurrency).toUpperCase(),
        frequency,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["donor", "me"] });
      toast.success(t("donor.wizard.success"));
      navigate("/donor/sponsorships", { replace: true });
    },
    onError: (err) => {
      if (err instanceof AxiosError && err.response?.status === 409) {
        setServerError(t("donor.wizard.duplicate"));
        return;
      }
      const detail =
        err instanceof AxiosError
          ? err.response?.data?.detail
          : null;
      setServerError(detail ? String(detail) : t("donor.wizard.error"));
    },
  });

  function validateAmountStep(): boolean {
    const okAmount = amountSchema.safeParse(amount).success;
    const okCurrency = currencySchema.safeParse(effectiveCurrency).success;
    setAmountError(okAmount ? null : t("donor.wizard.amountInvalid"));
    setCurrencyError(okCurrency ? null : t("donor.wizard.currencyInvalid"));
    return okAmount && okCurrency;
  }

  if (orphanQ.isLoading || meQ.isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (orphanQ.error || !orphanQ.data || !meQ.data) {
    return (
      <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100">
        {t("common.loadError")}
      </p>
    );
  }
  const orphan = orphanQ.data;

  const stepLabels = [
    t("donor.wizard.stepOrphan"),
    t("donor.wizard.stepAmount"),
    t("donor.wizard.stepReview"),
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/orphans" className="text-sm text-trust-600 underline">
        ← {t("public.orphans.title")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("donor.wizard.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("donor.wizard.intro")}
        </p>
      </div>

      {/* Stepper */}
      <ol className="flex items-center gap-2" aria-label={t("donor.wizard.title")}>
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const state =
            n < step ? "done" : n === step ? "active" : "upcoming";
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                aria-current={n === step ? "step" : undefined}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  state === "upcoming"
                    ? "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                    : "bg-trust-500 text-white"
                }`}
              >
                {n}
              </span>
              <span
                className={`hidden text-sm sm:inline ${
                  state === "active"
                    ? "font-semibold text-gray-900 dark:text-gray-100"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {label}
              </span>
              {n < stepLabels.length && (
                <span className="h-px flex-1 bg-sky-200 dark:bg-gray-700" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step 1 — orphan summary */}
      {step === 1 && (
        <section className="card space-y-4">
          <header>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("donor.wizard.orphanSummaryTitle")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("donor.wizard.orphanSummaryHint")}
            </p>
          </header>
          <div className="panel space-y-2">
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {orphan.first_name}
            </p>
            <p className="font-mono text-xs text-gray-500">{orphan.code}</p>
            <dl className="grid grid-cols-2 gap-3 pt-2 text-sm">
              <div>
                <dt className="text-gray-500">{t("donor.orphanDetail.age")}</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {t("donor.orphanDetail.ageValue", { age: orphan.age_years })}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">
                  {t("donor.orphanDetail.gender")}
                </dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {orphan.gender === "M"
                    ? t("donor.orphanDetail.male")
                    : t("donor.orphanDetail.female")}
                </dd>
              </div>
              {orphan.country && (
                <div>
                  <dt className="text-gray-500">
                    {t("donor.orphanDetail.country")}
                  </dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {orphan.country}
                  </dd>
                </div>
              )}
            </dl>
            {orphan.short_description && (
              <p className="pt-2 text-sm text-gray-700 dark:text-gray-300">
                {orphan.short_description}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStep(2)}
            >
              {t("donor.wizard.next")}
            </button>
          </div>
        </section>
      )}

      {/* Step 2 — amount + frequency + currency */}
      {step === 2 && (
        <form
          className="card space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validateAmountStep()) setStep(3);
          }}
        >
          <header>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("donor.wizard.amountTitle")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("donor.wizard.amountHint")}
            </p>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t("donor.wizard.amount")}
              </span>
              <input
                className="input tabular-nums"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={amountError ? true : undefined}
                required
              />
              {amountError && (
                <span className="mt-1 block text-xs text-danger-600 dark:text-danger-100">
                  {amountError}
                </span>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t("donor.wizard.currency")}
              </span>
              <input
                className="input uppercase"
                maxLength={3}
                value={effectiveCurrency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                aria-invalid={currencyError ? true : undefined}
                required
              />
              {currencyError && (
                <span className="mt-1 block text-xs text-danger-600 dark:text-danger-100">
                  {currencyError}
                </span>
              )}
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("donor.wizard.frequency")}
            </span>
            <select
              className="input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`sponsorships.frequencies.${f}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-between">
            <button
              type="button"
              className="rounded-xl border border-sky-200 px-4 py-2 font-medium text-gray-700 transition hover:bg-tranquil-200 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => setStep(1)}
            >
              {t("donor.wizard.back")}
            </button>
            <button type="submit" className="btn-primary">
              {t("donor.wizard.next")}
            </button>
          </div>
        </form>
      )}

      {/* Step 3 — review + confirm */}
      {step === 3 && (
        <section className="card space-y-4">
          <header>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("donor.wizard.reviewTitle")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("donor.wizard.reviewHint")}
            </p>
          </header>
          <dl className="divide-y divide-sky-200 text-sm dark:divide-gray-700">
            <Row label={t("donor.wizard.orphanLabel")}>
              {orphan.first_name}{" "}
              <span className="font-mono text-xs text-gray-500">
                ({orphan.code})
              </span>
            </Row>
            <Row label={t("donor.wizard.amount")}>
              <span className="tabular-nums">
                {amount} {effectiveCurrency.toUpperCase()}
              </span>
            </Row>
            <Row label={t("donor.wizard.frequency")}>
              {t(`sponsorships.frequencies.${frequency}`)}
            </Row>
          </dl>

          <p className="rounded-xl bg-tranquil-200 px-3 py-2 text-xs text-trust-700 dark:bg-gray-700/60 dark:text-tranquil-200">
            {t("donor.wizard.payNote")}
          </p>

          {serverError && (
            <p
              role="alert"
              className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
            >
              {serverError}
            </p>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              className="rounded-xl border border-sky-200 px-4 py-2 font-medium text-gray-700 transition hover:bg-tranquil-200 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
              onClick={() => setStep(2)}
              disabled={mut.isPending}
            >
              {t("donor.wizard.back")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={mut.isPending}
              onClick={() => {
                setServerError(null);
                mut.mutate();
              }}
            >
              {mut.isPending
                ? t("donor.wizard.creating")
                : t("donor.wizard.confirm")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 dark:text-gray-100">
        {children}
      </dd>
    </div>
  );
}
