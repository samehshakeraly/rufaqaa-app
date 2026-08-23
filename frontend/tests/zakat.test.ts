import { describe, expect, it } from "vitest";

import {
  computeZakat,
  NISAB_GOLD_GRAMS,
  parseAmount,
  toPaymentAmount,
  ZAKAT_RATE,
  type ZakatInput,
} from "@/lib/zakat";

/** Every field empty — the calculator's starting state. An empty field
 * means ZERO, never an error. */
function input(over: Partial<ZakatInput> = {}): ZakatInput {
  return {
    cash: "",
    goldGrams: "",
    goldPricePerGram: "",
    silverGrams: "",
    silverPricePerGram: "",
    tradeGoods: "",
    receivables: "",
    debts: "",
    ...over,
  };
}

describe("parseAmount", () => {
  it("treats an empty or blank field as zero", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("   ")).toBe(0);
  });

  it("accepts grouping commas — \"8,400\" is 8400", () => {
    expect(parseAmount("8,400")).toBe(8400);
    expect(parseAmount("1,234,567.89")).toBe(1234567.89);
  });

  it("rejects negatives and non-numbers with null", () => {
    expect(parseAmount("-1")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12abc")).toBeNull();
    expect(parseAmount(",")).toBeNull();
  });

  it("parses plain decimals", () => {
    expect(parseAmount("10.5")).toBe(10.5);
    expect(parseAmount("0")).toBe(0);
  });
});

describe("computeZakat", () => {
  it("works a full example with known figures", () => {
    const result = computeZakat(
      input({
        cash: "10000",
        goldGrams: "100",
        goldPricePerGram: "80",
        silverGrams: "200",
        silverPricePerGram: "1",
        tradeGoods: "5000",
        receivables: "2000",
        debts: "3000",
      }),
    );
    // assets = 10000 + 100×80 + 200×1 + 5000 + 2000 = 25200
    // base   = 25200 − 3000 = 22200; nisab = 85×80 = 6800 → reached
    // due    = 22200 × 0.025 = 555
    expect(result).toEqual({
      ok: true,
      assets: 25200,
      debts: 3000,
      base: 22200,
      nisabValue: 6800,
      reachesNisab: true,
      due: 555,
    });
  });

  it("clamps a negative base to zero — a donor never sees a negative number", () => {
    const result = computeZakat(
      input({ cash: "1000", goldPricePerGram: "100", debts: "5000" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base).toBe(0);
    expect(result.reachesNisab).toBe(false);
    expect(result.due).toBe(0);
  });

  it("no gold price → no nisab value, nothing reached, nothing due", () => {
    const result = computeZakat(input({ cash: "1000000" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nisabValue).toBe(0);
    expect(result.reachesNisab).toBe(false);
    expect(result.due).toBe(0);
  });

  it("exactly at the nisab counts as reached", () => {
    const nisab = NISAB_GOLD_GRAMS * 100;
    const result = computeZakat(
      input({ cash: String(nisab), goldPricePerGram: "100" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base).toBe(nisab);
    expect(result.nisabValue).toBe(nisab);
    expect(result.reachesNisab).toBe(true);
    expect(result.due).toBe(nisab * ZAKAT_RATE);
  });

  it("accepts comma-formatted values like \"8,400\"", () => {
    const result = computeZakat(
      input({ cash: "8,400", goldPricePerGram: "80" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 8400 ≥ 6800 → reached; due = 8400 × 0.025 = 210
    expect(result.base).toBe(8400);
    expect(result.reachesNisab).toBe(true);
    expect(result.due).toBe(210);
  });

  it("names exactly the invalid fields, in form order", () => {
    const result = computeZakat(
      input({ cash: "abc", goldGrams: "5", debts: "-5" }),
    );
    expect(result).toEqual({ ok: false, invalidFields: ["cash", "debts"] });
  });

  it("rounds the due amount to two decimals", () => {
    const result = computeZakat(
      input({ cash: "1234.57", goldGrams: "0", goldPricePerGram: "1" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // nisab = 85; 1234.57 × 0.025 = 30.86425 → 30.86
    expect(result.reachesNisab).toBe(true);
    expect(result.due).toBe(30.86);
  });
});

describe("toPaymentAmount", () => {
  it("always carries exactly two decimals", () => {
    expect(toPaymentAmount(212.5)).toBe("212.50");
    expect(toPaymentAmount(555)).toBe("555.00");
    expect(toPaymentAmount(30.864)).toBe("30.86");
  });
});
