import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import {
  COUNTRY_CODES,
  countryOptions,
  flagEmoji,
  getCountryRequirements,
  listCountries,
} from "@/lib/countries";

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

describe("registration country API helpers", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("listCountries GETs /countries and returns the localized list", async () => {
    const items = [
      { code: "PS", name_ar: "فلسطين", name_en: "Palestine" },
      { code: "KW", name_ar: "الكويت", name_en: "Kuwait" },
    ];
    mock.onGet("/countries").reply(200, items);

    const result = await listCountries();

    expect(result).toEqual(items);
    expect(mock.history.get[0]?.url).toBe("/countries");
  });

  it("getCountryRequirements GETs the per-country requirements and returns the config", async () => {
    const config = {
      country_code: "PS",
      profile: "conflict",
      fields: {
        requires_gps: true,
        show_conflict_fields: true,
        show_housing: true,
        show_wash_fields: false,
      },
      national_id: { required: true, length: 9, regex: "^\\d{9}$" },
      phone: { regex: null },
      required_documents: ["displacement_proof"],
    };
    mock.onGet("/countries/PS/requirements").reply(200, config);

    const result = await getCountryRequirements("PS");

    expect(result).toEqual(config);
    expect(result.national_id.required).toBe(true);
  });

  it("propagates a 404 so the caller can fall back to the permissive baseline", async () => {
    mock.onGet("/countries/ZZ/requirements").reply(404);

    await expect(getCountryRequirements("ZZ")).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});
