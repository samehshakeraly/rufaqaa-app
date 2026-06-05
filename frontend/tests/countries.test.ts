import { describe, expect, it } from "vitest";

import { COUNTRY_CODES, countryOptions, flagEmoji } from "@/lib/countries";

// The label is `${flag} ${name}`; the flag has no internal space, so the
// localized name is everything after the first space.
const nameOf = (label: string) => label.slice(label.indexOf(" ") + 1);

describe("COUNTRY_CODES", () => {
  it("is a sizeable, unique, uppercase alpha-2 list including KW", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(COUNTRY_CODES).toContain("KW");
  });
});

describe("flagEmoji", () => {
  it("maps a two-letter code to its regional-indicator flag", () => {
    expect(flagEmoji("KW")).toBe("🇰🇼");
    expect(flagEmoji("kw")).toBe("🇰🇼"); // case-insensitive
  });

  it("returns an empty string for anything that isn't a two-letter code", () => {
    expect(flagEmoji("K")).toBe("");
    expect(flagEmoji("KWT")).toBe("");
    expect(flagEmoji("12")).toBe("");
    expect(flagEmoji("")).toBe("");
  });
});

describe("countryOptions", () => {
  it("returns one option per code with a flag-prefixed label", () => {
    const opts = countryOptions("en");
    expect(opts).toHaveLength(COUNTRY_CODES.length);
    const kw = opts.find((o) => o.code === "KW");
    expect(kw?.label).toBe("🇰🇼 Kuwait");
  });

  it("is sorted by the localized name", () => {
    const names = countryOptions("en").map((o) => nameOf(o.label));
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "en"));
    expect(names).toEqual(sorted);
  });

  it("localizes names per locale", () => {
    const ar = countryOptions("ar").find((o) => o.code === "KW");
    expect(ar?.label).toContain("🇰🇼");
    // Arabic display name differs from the English one.
    expect(ar?.label).not.toBe("🇰🇼 Kuwait");
  });

  it("falls back to the raw code when DisplayNames is unavailable", () => {
    // A structurally invalid BCP-47 tag makes DisplayNames throw on
    // construction; every label then degrades to the bare code.
    const kw = countryOptions("!bad").find((o) => o.code === "KW");
    expect(kw?.label).toBe("🇰🇼 KW");
  });
});
