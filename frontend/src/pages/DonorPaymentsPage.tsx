import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import type { PaymentRow, StatusChip } from "@/lib/donorPayments";
import {
  bankReferenceOf,
  buildPaymentRows,
  buildStatementCsv,
  countByStatus,
  effectiveDate,
  failedPaymentRows,
  filterPaymentRows,
  paymentAbout,
  paymentYears,
  pendingSponsorships,
  rowsInYear,
  showsBankReference,
  showsReceiptNumber,
  summarizeYear,
} from "@/lib/donorPayments";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { listMyPayments } from "@/lib/payments";
import type { DonorPaymentStatus } from "@/lib/paymentStatus";
import { DONOR_PAYMENT_STATUSES } from "@/lib/paymentStatus";
import type { Sponsorship } from "@/lib/sponsorships";
import { listMySponsorships } from "@/lib/sponsorships";

/** Server page size. The record paginates through real limit/offset
 * requests — the page never fetches everything to slice it locally.
 * Search, chips and the year summary therefore describe the LOADED
 * rows; for the vast majority of donors one page is the whole story. */
const PAGE_SIZE = 25;

const TAG_STYLES: Record<DonorPaymentStatus, string> = {
  completed:
    "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500",
  inProgress: "bg-info-50 text-info-700 dark:bg-info-500/15 dark:text-info-500",
  notCompleted:
    "bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-500",
  refunded: "bg-gray-100 text-gray-600 dark:bg-gray-400/10 dark:text-gray-400",
  underReview:
    "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500",
};

const DOT_STYLES: Record<DonorPaymentStatus, string> = {
  completed: "bg-success-500",
  inProgress: "bg-info-500",
  notCompleted: "bg-danger-500",
  refunded: "bg-gray-400",
  underReview: "bg-warning-500",
};

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M8 11l4 4 4-4M4 20h16" />
    </svg>
  );
}

/** PR-D08 — "My Payments": the donor's money trail. Replaces the old
 * sponsorships table (whose only unique job — paying a pending
 * sponsorship — lives on in the "needs completing" section here). */
export function DonorPaymentsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<StatusChip>("all");
  const [pickedYear, setPickedYear] = useState<number | "all" | null>(null);

  const paymentsQ = useQuery({
    queryKey: ["donor", "me", "payments", { offset }],
    queryFn: () => listMyPayments({ limit: PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });
  // Names + checkout paths come from the donor's own sponsorships; if
  // this fetch fails the record still renders (rows fall back to the
  // general-donation wording) and only the pending-checkout half of
  // "needs completing" goes quiet.
  const sponsorshipsQ = useQuery({
    queryKey: ["donor", "me", "portal-sponsorships"],
    queryFn: () => listMySponsorships({ limit: 100 }),
    retry: false,
  });

  const sponsorships: Sponsorship[] = useMemo(
    () => sponsorshipsQ.data?.items ?? [],
    [sponsorshipsQ.data],
  );

  const rows = useMemo(
    () => buildPaymentRows(paymentsQ.data?.items ?? [], sponsorships),
    [paymentsQ.data, sponsorships],
  );

  const counts = useMemo(() => countByStatus(rows), [rows]);
  // A chip can lose its rows when the server page changes underneath it;
  // an active chip with nothing behind it silently falls back to "all".
  const activeChip: StatusChip = counts[chip] > 0 ? chip : "all";
  const visible = useMemo(
    () => filterPaymentRows(rows, activeChip, query),
    [rows, activeChip, query],
  );
  const filtering = query.trim() !== "" || activeChip !== "all";

  const years = useMemo(() => paymentYears(rows), [rows]);
  const year: number | "all" = pickedYear ?? years[0] ?? "all";
  const summary = useMemo(() => summarizeYear(rows, year), [rows, year]);

  const pending = useMemo(() => pendingSponsorships(sponsorships), [sponsorships]);
  const failed = useMemo(() => failedPaymentRows(rows), [rows]);

  const total = paymentsQ.data?.total ?? 0;

  const exportCsv = () => {
    const csv = buildStatementCsv(rowsInYear(rows, year), {
      headers: [
        t("donor.payments.csv.date"),
        t("donor.payments.csv.code"),
        t("donor.payments.csv.about"),
        t("donor.payments.csv.amount"),
        t("donor.payments.csv.currency"),
        t("donor.payments.csv.method"),
        t("donor.payments.csv.status"),
        t("donor.payments.csv.receiptNumber"),
        t("donor.payments.csv.bankReference"),
        t("donor.payments.csv.gatewayTransactionId"),
      ],
      generalDonation: t("donor.payments.table.generalDonation"),
      waqfDonation: t("donor.payments.table.waqfDonation"),
      sponsorshipOf: (name) => t("donor.payments.table.sponsorshipOf", { name }),
      donationFor: (name) => t("donor.payments.table.donationFor", { name }),
      methodLabel: (m) => t(`payments.methods.${m}`, m),
      statusLabel: (s) => t(`donor.payments.statuses.${s}`),
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rufaqaa-statement-${year === "all" ? "all-years" : year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("donor.payments.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("donor.payments.subtitle")}
        </p>
      </header>

      {paymentsQ.isLoading && (
        <div className="space-y-5">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-10 w-full max-w-md rounded-xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}

      {paymentsQ.isError && (
        <div
          role="alert"
          className="card flex flex-col items-start gap-3 border-warning-500/40 p-5"
        >
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {t("common.loadError")}
          </p>
          <button
            type="button"
            onClick={() => paymentsQ.refetch()}
            className="btn-primary min-h-[44px]"
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {paymentsQ.isSuccess && (
        <>
          {total > 0 && (
            <YearSummaryCard
              years={years}
              year={year}
              onYearChange={setPickedYear}
              summary={summary}
              onExport={exportCsv}
              lang={lang}
            />
          )}

          {(pending.length > 0 || failed.length > 0) && (
            <NeedsCompletionSection
              pending={pending}
              failed={failed}
              lang={lang}
            />
          )}

          {total === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <label className="relative block max-w-sm">
                  <span className="sr-only">
                    {t("donor.payments.toolbar.searchLabel")}
                  </span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("donor.payments.toolbar.searchPlaceholder")}
                    className="input min-h-[44px] ps-9"
                  />
                </label>
                <div
                  role="group"
                  aria-label={t("donor.payments.toolbar.filtersLabel")}
                  className="flex flex-wrap gap-2"
                >
                  {(["all", ...DONOR_PAYMENT_STATUSES] as StatusChip[])
                    .filter((key) => key === "all" || counts[key] > 0)
                    .map((key) => {
                      const selected = activeChip === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setChip(key)}
                          className={`min-h-[44px] rounded-full px-4 py-1.5 text-sm font-medium transition ${
                            selected
                              ? "bg-trust-500 text-white shadow-sm"
                              : "border border-sky-200 bg-white text-gray-700 hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                          }`}
                        >
                          {key === "all"
                            ? t("donor.payments.statuses.all")
                            : t(`donor.payments.statuses.${key}`)}
                          <span
                            className={`ms-1.5 text-xs ${selected ? "text-white/80" : "text-gray-500 dark:text-gray-400"}`}
                          >
                            {counts[key]}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {visible.length === 0 && filtering ? (
                <div className="card flex flex-col items-center gap-3 p-8 text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {t("donor.payments.noResults")}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setChip("all");
                    }}
                    className="btn-secondary min-h-[44px]"
                  >
                    {t("donor.payments.clearFilters")}
                  </button>
                </div>
              ) : (
                <PaymentsRecord
                  visible={visible}
                  lang={lang}
                  filtering={filtering}
                  total={total}
                  offset={offset}
                  loadedCount={rows.length}
                  onOffsetChange={setOffset}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Gradient opener: what this year's giving adds up to + the statement
 * export. Deliberately committed to a light-on-trust look in both
 * themes (the dark theme deepens the gradient, text stays white). */
function YearSummaryCard({
  years,
  year,
  onYearChange,
  summary,
  onExport,
  lang,
}: {
  years: number[];
  year: number | "all";
  onYearChange: (next: number | "all") => void;
  summary: ReturnType<typeof summarizeYear>;
  onExport: () => void;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("donor.payments.year.ariaLabel")}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-bl from-trust-600 via-trust-400 to-trust-300 p-6 text-white shadow-md dark:from-trust-900 dark:via-trust-700 dark:to-trust-600"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-white/80">
            {year === "all"
              ? t("donor.payments.year.totalAll")
              : t("donor.payments.year.totalIn", { year })}
          </p>
          {summary ? (
            <>
              <p className="mt-1 text-3xl font-bold">
                {formatMoney(summary.dominant.total, summary.dominant.currency, lang)}
                {summary.otherCurrenciesCount > 0 && (
                  <span className="ms-2 text-sm font-medium text-white/85">
                    {t("donor.payments.year.otherCurrencies", {
                      n: summary.otherCurrenciesCount,
                    })}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-white/75">
                {t("donor.payments.year.completedCount", {
                  n: summary.completedCount,
                })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm font-medium text-white/85">
              {t("donor.payments.year.none")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("donor.payments.year.selectLabel")}
            value={year === "all" ? "all" : String(year)}
            onChange={(e) =>
              onYearChange(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="min-h-[44px] rounded-xl border border-white/30 bg-white/15 px-3 py-2 text-sm font-semibold text-white [&>option]:text-gray-900"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="all">{t("donor.payments.year.allYears")}</option>
          </select>
          <button
            type="button"
            onClick={onExport}
            title={t("donor.payments.year.export")}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-trust-700 transition hover:bg-tranquil-100"
          >
            <DownloadIcon />
            {t("donor.payments.year.export")}
          </button>
        </div>
      </div>
    </section>
  );
}

/** "Needs completing" — the two kinds of unfinished action, together:
 * a sponsorship created but never paid, and a payment that didn't go
 * through. The section is NOT rendered at all when both lists are
 * empty (the page never says "nothing needs you"). */
function NeedsCompletionSection({
  pending,
  failed,
  lang,
}: {
  pending: Sponsorship[];
  failed: PaymentRow[];
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("donor.payments.attention.title")}
      className="rounded-2xl border border-warning-100 bg-warning-50 p-4 dark:border-warning-500/25 dark:bg-warning-500/10 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-warning-600"
          aria-hidden="true"
        >
          <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9.2" />
        </svg>
        <h2 className="text-sm font-bold text-warning-700 dark:text-warning-500">
          {t("donor.payments.attention.title")}
        </h2>
        <span className="rounded-full bg-warning-600 px-2 py-0.5 text-xs font-bold text-white">
          {pending.length + failed.length}
        </span>
      </div>
      <ul className="space-y-2.5">
        {pending.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-white p-3.5 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="min-w-[180px] flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t("donor.payments.attention.pendingTitle", {
                  name: s.orphan_name ?? s.orphan_code,
                })}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("donor.payments.attention.pendingMeta")}{" "}
                <span className="font-mono">{s.code}</span>
              </p>
            </div>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {formatMoney(s.monthly_amount, s.currency, lang)}
            </span>
            <Link
              to={`/sponsor/${s.orphan_code}/checkout`}
              className="btn-primary min-h-[44px] text-sm"
            >
              {t("donor.payments.attention.completePay")}
            </Link>
          </li>
        ))}
        {failed.map((row) => (
          <li
            key={row.payment.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-white p-3.5 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="min-w-[180px] flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {row.sponsorship?.orphan_name
                  ? t("donor.payments.attention.failedTitle", {
                      name: row.sponsorship.orphan_name,
                    })
                  : t("donor.payments.attention.failedGeneralTitle")}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {formatDate(effectiveDate(row.payment), lang)} ·{" "}
                <span className="font-mono">{row.payment.code}</span>
              </p>
            </div>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {formatMoney(row.payment.amount, row.payment.currency, lang)}
            </span>
            <RetryLink row={row} className="btn-primary min-h-[44px] text-sm" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every failure carries an exit: back to checkout when we know which
 * sponsorship to finish, otherwise to browsing (the same recovery path
 * the payment-failure page uses). */
function RetryLink({ row, className }: { row: PaymentRow; className: string }) {
  const { t } = useTranslation();
  const to = row.sponsorship?.orphan_code
    ? `/sponsor/${row.sponsorship.orphan_code}/checkout`
    : "/orphans";
  return (
    <Link to={to} className={className}>
      {t("donor.payments.attention.retry")}
    </Link>
  );
}

function StatusTag({ status }: { status: DonorPaymentStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TAG_STYLES[status]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[status]}`}
      />
      {t(`donor.payments.statuses.${status}`)}
    </span>
  );
}

/** Amounts that never (or no longer) reached the waqf are struck
 * through and dimmed so they read differently at a glance. */
function AmountCell({ row, lang }: { row: PaymentRow; lang: string }) {
  const uncollected = row.status === "notCompleted" || row.status === "refunded";
  return (
    <span
      className={`whitespace-nowrap font-mono font-bold ${
        uncollected
          ? "text-gray-400 line-through decoration-1 dark:text-gray-500"
          : "text-gray-900 dark:text-gray-100"
      }`}
    >
      {formatMoney(row.payment.amount, row.payment.currency, lang)}
    </span>
  );
}

/** The per-row action, by folded status. Statuses whose action is a
 * conversation (refunded / under review) link to the contact page —
 * refund and review vocabulary stays out of the donor's face. */
function RowAction({ row }: { row: PaymentRow }) {
  const { t } = useTranslation();
  switch (row.status) {
    case "completed":
      if (!row.payment.receipt_url) return null;
      return (
        <a
          href={row.payment.receipt_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("donor.payments.table.receiptAria", {
            code: row.payment.code,
          })}
          title={t("donor.payments.table.receiptAria", { code: row.payment.code })}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-trust-600 transition hover:bg-tranquil-100 dark:text-trust-100 dark:hover:bg-gray-700"
        >
          <DownloadIcon />
          {t("donor.payments.table.receipt")}
        </a>
      );
    case "notCompleted":
      return (
        <RetryLink
          row={row}
          className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 py-1.5 text-sm font-semibold text-warning-600 transition hover:bg-warning-50 dark:hover:bg-warning-500/10"
        />
      );
    case "inProgress":
      return (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("donor.payments.table.waiting")}
        </span>
      );
    case "refunded":
      return (
        <Link
          to="/contact"
          className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-tranquil-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {t("donor.payments.table.refundDetails")}
        </Link>
      );
    case "underReview":
      return (
        <Link
          to="/contact"
          className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-tranquil-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {t("donor.payments.table.contactUs")}
        </Link>
      );
  }
}

/** What the payment was for. Child privacy: name + codes only.
 * Three-step precedence (PR-D09): matched sponsorship → the payment's
 * own child (orphan_name comes on the payment itself now) → general. */
function AboutCell({ row }: { row: PaymentRow }) {
  const { t } = useTranslation();
  const about = paymentAbout(row);
  // The two child-less kinds carry no name and no code — one line each.
  if (about.kind === "general" || about.kind === "waqf") {
    return (
      <div className="font-medium text-gray-900 dark:text-gray-100">
        {about.kind === "waqf"
          ? t("donor.payments.table.waqfDonation")
          : t("donor.payments.table.generalDonation")}
      </div>
    );
  }
  return (
    <>
      <div className="font-medium text-gray-900 dark:text-gray-100">
        {about.kind === "sponsorship"
          ? t("donor.payments.table.sponsorshipOf", { name: about.name })
          : t("donor.payments.table.donationFor", { name: about.name })}
      </div>
      {about.code && (
        <div className="mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400">
          {about.code}
        </div>
      )}
    </>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 5 5 9-11" />
    </svg>
  );
}

/** The bank reference is long and gets copied, not read — a one-tap
 * copy with a visible "copied" confirmation. */
function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the number stays visible on screen.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t("donor.payments.table.copyAria")}
      title={t("donor.payments.table.copyAria")}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-1.5 text-gray-500 transition hover:bg-tranquil-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span role="status" className="text-xs font-medium">
        {copied ? t("donor.payments.table.copied") : null}
      </span>
    </button>
  );
}

/** Each number where it is used (PR-D09): the receipt number beside the
 * receipt link on a completed row; the bank reference — with a copy
 * button — on a row the donor may need to call their bank about. */
function ReferenceLine({ row, align = "start" }: { row: PaymentRow; align?: "start" | "end" }) {
  const { t } = useTranslation();
  if (showsReceiptNumber(row)) {
    return (
      <div
        className={`mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400 ${
          align === "end" ? "text-end" : ""
        }`}
      >
        {t("donor.payments.table.receiptNumber", {
          n: row.payment.receipt_number,
        })}
      </div>
    );
  }
  const ref = bankReferenceOf(row.payment);
  if (showsBankReference(row) && ref) {
    return (
      <div
        className={`mt-0.5 flex items-center gap-0.5 ${
          align === "end" ? "justify-end" : ""
        }`}
      >
        <span className="break-all font-mono text-xs text-gray-500 dark:text-gray-400">
          {t("donor.payments.table.bankReference", { n: ref })}
        </span>
        <CopyButton value={ref} />
      </div>
    );
  }
  return null;
}

/** The record itself: a table from 760px up, stacked cards below —
 * never a horizontal scroll on a phone. One shared footer paginates
 * through real limit/offset requests. */
function PaymentsRecord({
  visible,
  lang,
  filtering,
  total,
  offset,
  loadedCount,
  onOffsetChange,
}: {
  visible: PaymentRow[];
  lang: string;
  filtering: boolean;
  total: number;
  offset: number;
  loadedCount: number;
  onOffsetChange: (next: number) => void;
}) {
  const { t } = useTranslation();
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="card overflow-hidden p-0">
      <div className="hidden overflow-x-auto min-[760px]:block">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-sky-200 bg-tranquil-100 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400">
              <th className="px-4 py-3 text-start font-semibold">
                {t("donor.payments.table.date")}
              </th>
              <th className="px-4 py-3 text-start font-semibold">
                {t("donor.payments.table.about")}
              </th>
              <th className="px-4 py-3 text-start font-semibold">
                {t("donor.payments.table.amount")}
              </th>
              <th className="px-4 py-3 text-start font-semibold">
                {t("donor.payments.table.method")}
              </th>
              <th className="px-4 py-3 text-start font-semibold">
                {t("donor.payments.table.status")}
              </th>
              <th className="px-4 py-3">
                <span className="sr-only">{t("donor.payments.table.action")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sky-200/60 dark:divide-gray-700">
            {visible.map((row) => (
              <tr
                key={row.payment.id}
                className="transition hover:bg-tranquil-100/60 dark:hover:bg-gray-700/40"
              >
                <td className="whitespace-nowrap px-4 py-3.5 align-middle">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {formatDate(effectiveDate(row.payment), lang)}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {row.payment.code}
                  </div>
                </td>
                <td className="px-4 py-3.5 align-middle">
                  <AboutCell row={row} />
                </td>
                <td className="px-4 py-3.5 align-middle">
                  <AmountCell row={row} lang={lang} />
                </td>
                <td className="px-4 py-3.5 align-middle text-xs text-gray-500 dark:text-gray-400">
                  {t(`payments.methods.${row.payment.payment_method}`, {
                    defaultValue: row.payment.payment_method,
                  })}
                </td>
                <td className="px-4 py-3.5 align-middle">
                  <StatusTag status={row.status} />
                </td>
                <td className="px-4 py-3.5 text-end align-middle">
                  <RowAction row={row} />
                  <ReferenceLine row={row} align="end" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2.5 p-3 min-[760px]:hidden">
        {visible.map((row) => (
          <li
            key={row.payment.id}
            className="rounded-xl border border-sky-200/70 p-3.5 dark:border-gray-700"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <AmountCell row={row} lang={lang} />
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  <AboutCell row={row} />
                </div>
              </div>
              <StatusTag status={row.status} />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {formatDate(effectiveDate(row.payment), lang)} ·{" "}
              {t(`payments.methods.${row.payment.payment_method}`, {
                defaultValue: row.payment.payment_method,
              })}{" "}
              · <span className="font-mono">{row.payment.code}</span>
            </p>
            <ReferenceLine row={row} />
            <div className="mt-2 border-t border-dashed border-sky-200/70 pt-1 dark:border-gray-700">
              <RowAction row={row} />
            </div>
          </li>
        ))}
      </ul>

      {total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-200 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <span>
            {filtering
              ? t("donor.payments.showingFiltered", { n: visible.length })
              : t("donor.payments.showingRange", {
                  from: offset + 1,
                  to: offset + loadedCount,
                  total,
                })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => onOffsetChange(Math.max(0, offset - PAGE_SIZE))}
              className="min-h-[44px] rounded-lg border border-sky-200 px-4 py-1.5 text-gray-700 transition hover:bg-tranquil-100 disabled:cursor-default disabled:opacity-45 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t("pagination.prev")}
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => onOffsetChange(offset + PAGE_SIZE)}
              className="min-h-[44px] rounded-lg border border-sky-200 px-4 py-1.5 text-gray-700 transition hover:bg-tranquil-100 disabled:cursor-default disabled:opacity-45 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t("pagination.next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** First-visit warmth: what will appear here, and the first step. */
function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="card flex flex-col items-center p-10 text-center">
      <div
        aria-hidden="true"
        className="grid h-16 w-16 place-items-center rounded-2xl bg-tranquil-200 text-trust-500 dark:bg-trust-500/15 dark:text-trust-200"
      >
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6.5h16v11H4z" />
          <path d="M4 10h16M7.5 14h4" />
        </svg>
      </div>
      <h2 className="mt-5 text-xl font-bold text-gray-900 dark:text-gray-100">
        {t("donor.payments.empty.title")}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {t("donor.payments.empty.body")}
      </p>
      <Link to="/orphans" className="btn-primary mt-6 min-h-[44px]">
        {t("donor.payments.empty.browse")}
      </Link>
    </div>
  );
}
