import { describe, expect, it } from "vitest";

import ar from "@/i18n/ar.json";
import en from "@/i18n/en.json";

// Flatten a nested translation object into dotted leaf keys.
function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      out.push(...leafKeys(value as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

// Arabic is the platform default and English the fallback pair — every UI
// string must exist in BOTH files. This locks the ar/en key sets together so
// a key added to one file without the other fails CI instead of silently
// rendering a raw key at runtime. (French is a phased rollout that falls back
// to English by design — see tests/i18n.test.tsx — so it is exempt here.)
describe("i18n ar/en key parity", () => {
  it("ar and en carry exactly the same keys", () => {
    const arKeys = new Set(leafKeys(ar));
    const enKeys = new Set(leafKeys(en));
    const onlyAr = [...arKeys].filter((k) => !enKeys.has(k));
    const onlyEn = [...enKeys].filter((k) => !arKeys.has(k));
    expect(onlyAr, "keys present in ar.json but missing from en.json").toEqual([]);
    expect(onlyEn, "keys present in en.json but missing from ar.json").toEqual([]);
  });
});
