/**
 * ISO 3166-1 alpha-2 country data for the platform org forms.
 *
 * Two layers live here:
 *   1. A static, frontend-only label helper (`countryOptions` / `flagEmoji`)
 *      that turns a stored two-letter `country_code` into a localized,
 *      flag-prefixed label for a native <select> (used by the org forms).
 *   2. Server-backed registration helpers (`listCountries`,
 *      `getCountryRequirements`) that drive the country-aware orphan form —
 *      the API only offers ACTIVE countries and resolves each one's intake
 *      requirements (national_id rule, conditional fields, documents).
 */

import type { components } from "@/api/schema.gen";

import { api } from "./api";

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

// ── Registration country data (server-backed) ─────────────────────────────
// Thin API wrappers, mirroring lib/orphans.ts. Distinct from the static label
// helpers above: these hit the backend so the orphan registration form only
// ever offers active countries and can resolve each country's requirements.

/** One active country for the registration <select> (ISO alpha-2 + labels). */
export type CountryListItem = components["schemas"]["CountryListItem"];
/** Resolved registration requirements for a country. */
export type CountryRequirements = components["schemas"]["CountryRequirementsResponse"];
/** national_id rule (required / exact length / full-match regex). */
export type NationalIdRequirements = components["schemas"]["NationalIdRequirements"];
/** Which conditional intake sections a country turns on. */
export type CountryFieldFlags = components["schemas"]["CountryFieldFlags"];

/** GET /countries — active countries for the registration dropdown. */
export async function listCountries(): Promise<CountryListItem[]> {
  const { data } = await api.get<CountryListItem[]>("/countries");
  return data;
}

/**
 * GET /countries/{code}/requirements — resolved intake config for `code`
 * (ISO alpha-2). 404 when `code` is not a known country; a known country with
 * no configured row resolves server-side to the permissive baseline. Callers
 * treat any failure as that baseline (nothing extra required).
 */
export async function getCountryRequirements(code: string): Promise<CountryRequirements> {
  const { data } = await api.get<CountryRequirements>(
    `/countries/${encodeURIComponent(code)}/requirements`,
  );
  return data;
}
