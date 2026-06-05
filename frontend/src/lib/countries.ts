/**
 * ISO 3166-1 alpha-2 country data for the platform org forms.
 *
 * Frontend-only: the value persisted server-side stays the raw two-letter
 * code (`country_code`). This module just turns that code into a localized,
 * flag-prefixed label for a native <select>.
 */

// Complete ISO 3166-1 alpha-2 list (249 officially assigned codes), uppercase.
export const COUNTRY_CODES: string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR",
  "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE",
  "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ",
  "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD",
  "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR",
  "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI",
  "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS",
  "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK",
  "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME",
  "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ",
  "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU",
  "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS",
  "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI",
  "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV",
  "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK",
  "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA",
  "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
];

/**
 * ISO-3166 alpha-2 → regional-indicator flag emoji (derived from the
 * stored country_code; no external data). Returns "" for anything that
 * isn't a two-letter code.
 */
export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export interface CountryOption {
  code: string;
  label: string;
}

// Memoize the (relatively expensive) localized + sorted build per locale.
const optionsCache = new Map<string, CountryOption[]>();

/**
 * Localized, flag-prefixed country options for a <select>, sorted by the
 * localized name. Uses Intl.DisplayNames when available; falls back to the
 * raw code as the label when DisplayNames is missing or returns nothing.
 */
export function countryOptions(locale: string): CountryOption[] {
  const cached = optionsCache.get(locale);
  if (cached) return cached;

  let display: Intl.DisplayNames | undefined;
  try {
    display = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    display = undefined;
  }

  const options = COUNTRY_CODES.map((code) => {
    let name = code;
    try {
      name = display?.of(code) || code;
    } catch {
      name = code;
    }
    return { code, label: `${flagEmoji(code)} ${name}`.trim(), name };
  });

  // Sort by the localized name. localeCompare rejects a malformed locale
  // tag (the same tags that break DisplayNames above), so fall back to a
  // locale-agnostic compare rather than letting the sort throw.
  try {
    options.sort((a, b) => a.name.localeCompare(b.name, locale));
  } catch {
    options.sort((a, b) => a.name.localeCompare(b.name));
  }

  const result = options.map(({ code, label }) => ({ code, label }));
  optionsCache.set(locale, result);
  return result;
}
