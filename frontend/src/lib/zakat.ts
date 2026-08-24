/** Pure logic behind the simplified zakat calculator (PR-Z01).
 *
 * The platform does not issue religious rulings. This module applies the
 * well-known position ONLY — nisab = 85g of gold, rate = 2.5% after a
 * lunar year — and the page states, in a fixed line, that schools of law
 * differ on the details and the estimate is the donor's own
 * responsibility.
 *
 * Deliberately absent: any lunar-year (hawl) computation. The system
 * does not know when the donor acquired the wealth, so no date enters
 * this module — the condition lives in the explanatory copy alone.
 * Likewise absent: a gold price source. The donor types the price; the
 * system fetches nothing.
 *
 * Everything is a pure function of its inputs — no clock, no i18n, no
 * fetching — so the money rules stay unit-testable in isolation. */

export const NISAB_GOLD_GRAMS = 85;
export const ZAKAT_RATE = 0.025;

/** Everything the donor can type, as the raw strings they typed. The
 * page never parses; parsing and its edge cases all live here. */
export interface ZakatInput {
  cash: string;
  goldGrams: string;
  goldPricePerGram: string;
  silverGrams: string;
  silverPricePerGram: string;
  tradeGoods: string;
  receivables: string;
  debts: string;
}

/** The one rounding rule of the whole track. `number` is enough here:
 * amounts are donor-typed estimates, not ledger rows — no decimal
 * library is warranted, and the payment amount leaves as a fixed
 * two-decimal string via `toPaymentAmount`. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse one typed amount. An empty field means ZERO, not an error — a
 * donor with no silver simply leaves the silver field alone. Grouping
 * commas are accepted ("8,400" is 8400); negatives and non-numbers are
 * rejected with null so the page can mark the exact field. */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  // Grouping commas only — a bare "," or ",5" is not a number.
  const normalized = trimmed.replace(/,/g, "");
  if (normalized === "") return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

export type ZakatResult =
  | { ok: false; invalidFields: (keyof ZakatInput)[] }
  | {
      ok: true;
      assets: number;
      debts: number;
      base: number;
      nisabValue: number;
      reachesNisab: boolean;
      due: number;
    };

/** Field order is the form order — invalidFields comes back in it. */
const FIELDS: readonly (keyof ZakatInput)[] = [
  "cash",
  "goldGrams",
  "goldPricePerGram",
  "silverGrams",
  "silverPricePerGram",
  "tradeGoods",
  "receivables",
  "debts",
];

/** The whole calculation, in one place.
 *
 * base = (cash + gold×price + silver×price + trade goods + receivables)
 *        − debts, clamped to 0 — a donor is never shown a negative
 * number. nisab is valued in GOLD only (the well-known position this
 * calculator applies): with no gold price typed there is no nisab value
 * to compare against, so `reachesNisab` is false and nothing is due —
 * the calculator refuses to guess a price rather than inventing one. */
export function computeZakat(input: ZakatInput): ZakatResult {
  const parsed = {} as Record<keyof ZakatInput, number>;
  const invalidFields: (keyof ZakatInput)[] = [];
  for (const field of FIELDS) {
    const value = parseAmount(input[field]);
    if (value === null) invalidFields.push(field);
    else parsed[field] = value;
  }
  if (invalidFields.length > 0) return { ok: false, invalidFields };

  const assets = round2(
    parsed.cash +
      parsed.goldGrams * parsed.goldPricePerGram +
      parsed.silverGrams * parsed.silverPricePerGram +
      parsed.tradeGoods +
      parsed.receivables,
  );
  const debts = round2(parsed.debts);
  const base = round2(Math.max(0, assets - debts));
  const nisabValue = round2(NISAB_GOLD_GRAMS * parsed.goldPricePerGram);
  const reachesNisab = parsed.goldPricePerGram > 0 && base >= nisabValue;
  const due = reachesNisab ? round2(base * ZAKAT_RATE) : 0;

  return { ok: true, assets, debts, base, nisabValue, reachesNisab, due };
}

/** The gateway takes a decimal STRING; the due amount leaves as exactly
 * two decimals ("212.50", never "212.5") so what the donor confirmed is
 * what the request carries. */
export function toPaymentAmount(n: number): string {
  return round2(n).toFixed(2);
}
