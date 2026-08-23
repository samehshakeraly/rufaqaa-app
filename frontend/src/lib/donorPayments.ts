/** Pure logic behind the donor "My Payments" page (PR-D08).
 *
 * The page reads two donor-scoped endpoints the app already has —
 * /me/payments (the money trail) and /me/sponsorships (for child names
 * and the pending-checkout path) — and joins them on the client via
 * `sponsorship_id`. Everything here is a pure function of its inputs so
 * the fold/filter/summary/export rules are unit-testable in isolation.
 *
 * Privacy rule carried through every helper: the ONLY child fields that
 * ever surface are the name and the codes (orphan/sponsorship). */

import { buildCsv } from "./csv";
import type { PaymentDonorRead } from "./payments";
import { foldPaymentStatus, type DonorPaymentStatus } from "./paymentStatus";
import type { Sponsorship } from "./sponsorships";

/** One table row: the payment plus the sponsorship it belongs to (null
 * for a general donation) and its pre-folded donor-facing status. */
export interface PaymentRow {
  payment: PaymentDonorRead;
  sponsorship: Sponsorship | null;
  status: DonorPaymentStatus;
}

/** Join payments × sponsorships. Handles a payment whose sponsorship is
 * not in the provided list (old/archived) — it renders like a general
 * donation minus the name, never crashes. */
export function buildPaymentRows(
  payments: PaymentDonorRead[],
  sponsorships: Sponsorship[],
): PaymentRow[] {
  const byId = new Map(sponsorships.map((s) => [s.id, s]));
  return payments.map((payment) => ({
    payment,
    sponsorship: payment.sponsorship_id
      ? (byId.get(payment.sponsorship_id) ?? null)
      : null,
    status: foldPaymentStatus(payment.status),
  }));
}

/** The moment a payment "happened" for display/statement purposes. */
export function effectiveDate(payment: PaymentDonorRead): string {
  return payment.completed_at ?? payment.initiated_at;
}

/** What the payment was for, by the four-step precedence (PR-D09,
 * extended in PR-W01): a matched sponsorship wins; otherwise the
 * payment's own child (the server now sends orphan_name/orphan_code on
 * the payment itself); otherwise the pool it was tagged for; only an
 * untagged payment with no child at all reads as a general donation. */
export type PaymentAbout =
  | { kind: "sponsorship"; name: string; code: string }
  | { kind: "orphan"; name: string; code: string | null }
  | { kind: "waqf" }
  | { kind: "general" };

export function paymentAbout(row: PaymentRow): PaymentAbout {
  if (row.sponsorship?.orphan_name) {
    return {
      kind: "sponsorship",
      name: row.sponsorship.orphan_name,
      code: row.sponsorship.code,
    };
  }
  if (row.payment.orphan_name) {
    return {
      kind: "orphan",
      name: row.payment.orphan_name,
      code: row.payment.orphan_code ?? null,
    };
  }
  // A waqf payment carries no child by construction, so it can only be
  // told apart from a plain one-off donation by its tag.
  if (row.payment.target_type === "waqf") return { kind: "waqf" };
  return { kind: "general" };
}

/** The number a donor takes to their bank about a payment that went
 * wrong. bank_reference wins when both exist (it's the one the bank
 * recognises); the gateway transaction id is the fallback. */
export function bankReferenceOf(payment: PaymentDonorRead): string | null {
  return payment.bank_reference ?? payment.gateway_transaction_id ?? null;
}

/** Each number appears only where it is used: the bank reference only on
 * rows whose donor might need to call their bank. */
const BANK_REFERENCE_STATUSES: ReadonlySet<DonorPaymentStatus> = new Set([
  "notCompleted",
  "underReview",
  "refunded",
]);

export function showsBankReference(row: PaymentRow): boolean {
  return BANK_REFERENCE_STATUSES.has(row.status) && bankReferenceOf(row.payment) !== null;
}

/** …and the receipt number only on a completed row that actually has one. */
export function showsReceiptNumber(row: PaymentRow): boolean {
  return row.status === "completed" && !!row.payment.receipt_number;
}

export type StatusChip = "all" | DonorPaymentStatus;

/** Client-side narrowing: one status chip + a text query over the
 * payment code and the child's name (from the matched sponsorship or
 * from the payment itself). */
export function filterPaymentRows(
  rows: PaymentRow[],
  chip: StatusChip,
  query: string,
): PaymentRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (chip !== "all" && row.status !== chip) return false;
    if (!q) return true;
    const code = row.payment.code.toLowerCase();
    const name = (row.sponsorship?.orphan_name ?? row.payment.orphan_name ?? "").toLowerCase();
    return code.includes(q) || name.includes(q);
  });
}

/** Row count per chip over the loaded rows — a chip whose count is zero
 * is hidden by the toolbar. */
export function countByStatus(
  rows: PaymentRow[],
): Record<StatusChip, number> {
  const counts: Record<StatusChip, number> = {
    all: rows.length,
    completed: 0,
    inProgress: 0,
    notCompleted: 0,
    refunded: 0,
    underReview: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Distinct years present in the loaded rows, newest first. */
export function paymentYears(rows: PaymentRow[]): number[] {
  const years = new Set<number>();
  for (const row of rows) {
    const y = new Date(effectiveDate(row.payment)).getFullYear();
    if (Number.isFinite(y)) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

export function rowsInYear(rows: PaymentRow[], year: number | "all"): PaymentRow[] {
  if (year === "all") return rows;
  return rows.filter(
    (row) => new Date(effectiveDate(row.payment)).getFullYear() === year,
  );
}

/** Year-summary money. Mixed currencies are NEVER summed — the dominant
 * currency (most completed payments, ties → larger total) is shown with
 * a "+ n other currencies" note. Same rule as the My Orphans ImpactBar. */
export interface YearSummary {
  dominant: { currency: string; total: number; count: number };
  otherCurrenciesCount: number;
  /** Completed payments in the year, across ALL currencies. */
  completedCount: number;
}

/** Aggregate the COMPLETED payments of a year. Null when the year holds
 * no completed payment at all. */
export function summarizeYear(
  rows: PaymentRow[],
  year: number | "all",
): YearSummary | null {
  const completed = rowsInYear(rows, year).filter(
    (row) => row.status === "completed",
  );
  if (completed.length === 0) return null;

  const buckets = new Map<string, { currency: string; total: number; count: number }>();
  for (const row of completed) {
    const bucket = buckets.get(row.payment.currency) ?? {
      currency: row.payment.currency,
      total: 0,
      count: 0,
    };
    bucket.count += 1;
    const amount = Number(row.payment.amount);
    if (Number.isFinite(amount)) bucket.total += amount;
    buckets.set(row.payment.currency, bucket);
  }

  const ranked = [...buckets.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.total - a.total ||
      a.currency.localeCompare(b.currency),
  );

  const dominant = ranked[0];
  if (!dominant) return null;

  return {
    dominant,
    otherCurrenciesCount: ranked.length - 1,
    completedCount: completed.length,
  };
}

/** Localized strings the CSV builder needs — passed in so this module
 * stays free of i18n imports and pure. */
export interface StatementLabels {
  /** Column headers, in order: date, code, about, amount, currency,
   * method, status, receipt number, bank reference, gateway
   * transaction id. */
  headers: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  generalDonation: string;
  /** "وقف الأيتام" — the single-pool endowment (PR-W01). One label for
   * the table and the CSV, so the two never disagree. */
  waqfDonation: string;
  /** "كفالة {name}" — receives the child's name. */
  sponsorshipOf: (name: string) => string;
  /** "تبرّع لـ {name}" — a child-directed donation outside a sponsorship. */
  donationFor: (name: string) => string;
  methodLabel: (method: string) => string;
  statusLabel: (status: DonorPaymentStatus) => string;
}

/** The "about" cell of one statement row — same three-step precedence
 * as the page's AboutCell. */
function statementAbout(row: PaymentRow, labels: StatementLabels): string {
  const about = paymentAbout(row);
  switch (about.kind) {
    case "sponsorship":
      return `${labels.sponsorshipOf(about.name)} (${about.code})`;
    case "orphan":
      return about.code
        ? `${labels.donationFor(about.name)} (${about.code})`
        : labels.donationFor(about.name);
    case "waqf":
      return labels.waqfDonation;
    case "general":
      return labels.generalDonation;
  }
}

/** The year statement as CSV (client-built from the loaded rows). Dates
 * are ISO (YYYY-MM-DD) so the file sorts and imports cleanly regardless
 * of the UI locale. */
export function buildStatementCsv(
  rows: PaymentRow[],
  labels: StatementLabels,
): string {
  const matrix: (string | number | null)[][] = [labels.headers.slice()];
  for (const row of rows) {
    matrix.push([
      effectiveDate(row.payment).slice(0, 10),
      row.payment.code,
      statementAbout(row, labels),
      row.payment.amount,
      row.payment.currency,
      labels.methodLabel(row.payment.payment_method),
      labels.statusLabel(row.status),
      row.payment.receipt_number ?? "",
      row.payment.bank_reference ?? "",
      row.payment.gateway_transaction_id ?? "",
    ]);
  }
  return buildCsv(matrix);
}

/** Sponsorships still waiting for their first checkout — the first half
 * of the "needs completing" section. Only rows that can actually link to
 * checkout (orphan_code present) qualify: a dead-end CTA helps nobody. */
export function pendingSponsorships(sponsorships: Sponsorship[]): Sponsorship[] {
  return sponsorships.filter((s) => s.status === "pending" && s.orphan_code);
}

/** Failed payments — the second half of "needs completing". */
export function failedPaymentRows(rows: PaymentRow[]): PaymentRow[] {
  return rows.filter((row) => row.status === "notCompleted");
}
