/** Pure logic behind the orphans waqf track (PR-W01).
 *
 * The waqf is a general donation into a SINGLE pool: no child, no
 * sponsorship, no new model. A waqf payment is an ordinary payment
 * carrying `target_type === "waqf"` — that tag is the only thing that
 * distinguishes it, and it is the only thing this module reads.
 *
 * Deliberately absent: anything about yield, distribution or the pool's
 * size. The system knows none of it, so the portal never claims it. The
 * one waqf figure a donor can be shown is their OWN contribution,
 * derived here from the payments the portal already loads.
 *
 * Everything is a pure function of its inputs — no clock, no i18n, no
 * fetching — so the money rules stay unit-testable in isolation. */

import type { PaymentDonorRead } from "./payments";
import { foldPaymentStatus } from "./paymentStatus";

/** The suggested amounts on the contribution form. Plain numbers: the
 * page turns each into a display string through `formatMoney` and into
 * a request value through `String()` — never the other way round. */
export const WAQF_PRESETS = [10, 50, 100, 500] as const;

export interface MyWaqf {
  /** Dominant currency: most completed waqf payments, ties → larger total. */
  currency: string;
  /** Total in the DOMINANT currency only, as a decimal string for
   * `formatMoney`. Amounts in other currencies are NEVER folded in. */
  total: string;
  /** Completed waqf payments across ALL currencies. */
  count: number;
  /** How many further currencies the donor gave in, beyond the dominant. */
  otherCurrenciesCount: number;
}

/** What the donor has given to the waqf so far. Null when they have
 * given nothing yet — the page then renders no card at all, rather than
 * an "empty" one.
 *
 * Only COMPLETED waqf rows count: a pending or failed checkout is not a
 * contribution. Statuses go through `foldPaymentStatus` — raw gateway
 * statuses are operational vocabulary this module never reads directly.
 *
 * Mixed currencies are never summed. The ranking rule is the one
 * `summarizeYearToDate` in `donorDashboard.ts` already applies (most
 * payments, then larger total, then currency code for a stable order) —
 * the same rule, so two surfaces can never name different dominants. */
export function summarizeMyWaqf(payments: PaymentDonorRead[]): MyWaqf | null {
  const buckets = new Map<string, { currency: string; total: number; count: number }>();
  let count = 0;
  for (const p of payments) {
    if (p.target_type !== "waqf") continue;
    if (foldPaymentStatus(p.status) !== "completed") continue;
    count += 1;
    const bucket = buckets.get(p.currency) ?? {
      currency: p.currency,
      total: 0,
      count: 0,
    };
    bucket.count += 1;
    const amount = Number(p.amount);
    if (Number.isFinite(amount)) bucket.total += amount;
    buckets.set(p.currency, bucket);
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
    currency: dominant.currency,
    total: String(dominant.total),
    count,
    otherCurrenciesCount: ranked.length - 1,
  };
}

export type WaqfAmountError = "empty" | "nan" | "nonPositive";

export type WaqfAmount =
  | { ok: true; value: string }
  | { ok: false; reason: WaqfAmountError };

/** Gate a typed amount before it can reach `POST /payments/initiate`.
 * The backend refuses a non-positive amount with a 422 the donor can't
 * read; refusing it here keeps the failure in their own language.
 *
 * The accepted value is returned as the TRIMMED original string, not a
 * re-formatted number: the API takes a decimal string, and reprinting
 * "10.500" as "10.5" would be a silent edit of what the donor typed. */
export function validateWaqfAmount(raw: string): WaqfAmount {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, reason: "nan" };
  if (n <= 0) return { ok: false, reason: "nonPositive" };
  return { ok: true, value: trimmed };
}
