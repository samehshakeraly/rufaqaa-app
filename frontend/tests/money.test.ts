import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/money";

const EASTERN_ARABIC_DIGITS = /[٠-٩]/;

describe("formatMoney", () => {
  it.each([
    ["KWD", "ar"],
    ["KWD", "en"],
    ["KWD", "fr"],
    ["USD", "ar"],
    ["USD", "en"],
    ["USD", "fr"],
    ["EUR", "ar"],
    ["EUR", "en"],
    ["EUR", "fr"],
  ])("formats %s in %s with Latin digits only", (currency, lang) => {
    const out = formatMoney("1465.500", currency, lang);
    expect(out).toMatch(/465/);
    // Latin numerals are pinned on purpose (-u-nu-latn) — clearer in
    // IBM Plex Sans Arabic and identical across locales.
    expect(out).not.toMatch(EASTERN_ARABIC_DIGITS);
  });

  it("keeps KWD's three fraction digits", () => {
    expect(formatMoney("15", "KWD", "en")).toMatch(/15\.000/);
  });

  it("uses two fraction digits for USD and EUR", () => {
    expect(formatMoney("30", "USD", "en")).toMatch(/30\.00/);
    expect(formatMoney("30", "EUR", "en")).toMatch(/30/);
  });

  it("accepts the API's string amounts and plain numbers alike", () => {
    expect(formatMoney("420", "USD", "en")).toBe(formatMoney(420, "USD", "en"));
  });

  it("formats zero as a real amount, not a dash", () => {
    const out = formatMoney(0, "USD", "en");
    expect(out).toMatch(/0\.00/);
  });

  it("returns an em-dash for unparseable input", () => {
    expect(formatMoney("abc", "USD", "en")).toBe("—");
    expect(formatMoney("", "USD", "ar")).toBe("—");
    expect(formatMoney(Number.NaN, "USD", "fr")).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY, "USD", "en")).toBe("—");
  });

  it("falls back to a plain number + raw code for a malformed currency", () => {
    const out = formatMoney("12.5", "NOT_A_CODE", "en");
    expect(out).toContain("12.5");
    expect(out).toContain("NOT_A_CODE");
  });

  it("survives a malformed language tag", () => {
    const out = formatMoney("12", "USD", "not a lang!");
    expect(out).toMatch(/12/);
  });
});
