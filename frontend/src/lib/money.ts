/** Shared currency formatting for the donor portal.
 *
 * The API returns money as decimal strings ("1465.000") next to an ISO
 * currency code. Rendering them raw ("1465.000 KWD") reads like an
 * invoice, so every donor-facing amount goes through `formatMoney`.
 *
 * Numerals are pinned to Latin digits (`-u-nu-latn`) on purpose: they
 * render cleaner than Eastern-Arabic digits in IBM Plex Sans Arabic and
 * keep amounts identical across the ar/en/fr locales. */

const LATIN_DIGITS = "-u-nu-latn";

function currencyFormatter(
  locale: string,
  currency: string,
): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    // KWD carries 3 fraction digits, USD/EUR 2 — Intl knows per-currency.
  });
}

export function formatMoney(
  amount: string | number,
  currency: string,
  lang: string,
): string {
  const n =
    typeof amount === "number"
      ? amount
      : amount.trim() === ""
        ? Number.NaN
        : Number(amount);
  if (!Number.isFinite(n)) return "—";

  const base = (lang || "en").split("-")[0] || "en";
  try {
    return currencyFormatter(`${base}${LATIN_DIGITS}`, currency).format(n);
  } catch {
    // Bad language tag OR unknown currency code — try a known-good
    // locale first, then fall back to a plain Latin number + raw code.
    try {
      return currencyFormatter(`en${LATIN_DIGITS}`, currency).format(n);
    } catch {
      return `${new Intl.NumberFormat(`en${LATIN_DIGITS}`).format(n)} ${currency}`.trim();
    }
  }
}
