import { describe, expect, it } from "vitest";

import type { PaymentDonorRead } from "@/lib/payments";
import { summarizeMyWaqf, validateWaqfAmount, WAQF_PRESETS } from "@/lib/waqf";

let seq = 0;

function payment(over: Partial<PaymentDonorRead>): PaymentDonorRead {
  seq += 1;
  return {
    id: `p-${seq}`,
    code: `PAY-${1000 + seq}`,
    amount: "10.000",
    amount_in_default_currency: null,
    currency: "KWD",
    payment_method: "credit_card",
    status: "completed",
    initiated_at: "2026-03-01T10:00:00Z",
    completed_at: "2026-03-01T10:01:00Z",
    receipt_issued_at: null,
    receipt_number: null,
    receipt_url: null,
    sponsorship_id: null,
    orphan_id: null,
    target_type: "waqf",
    gateway_transaction_id: null,
    bank_reference: null,
    orphan_name: null,
    orphan_code: null,
    ...over,
  };
}

describe("summarizeMyWaqf", () => {
  it("returns null when the donor has given nothing to the waqf", () => {
    expect(summarizeMyWaqf([])).toBeNull();
  });

  it("totals the donor's completed waqf payments in one currency", () => {
    const mine = summarizeMyWaqf([
      payment({ amount: "10.000" }),
      payment({ amount: "50.000" }),
    ]);
    expect(mine).toEqual({
      currency: "KWD",
      total: "60",
      count: 2,
      otherCurrenciesCount: 1 - 1,
    });
  });

  it("never sums across currencies: the dominant one wins, the rest are counted", () => {
    const mine = summarizeMyWaqf([
      payment({ currency: "KWD", amount: "10" }),
      payment({ currency: "KWD", amount: "15" }),
      payment({ currency: "USD", amount: "1000" }),
      payment({ currency: "EUR", amount: "900" }),
    ]);
    // KWD has the most payments, so it is dominant even though USD holds
    // the larger number — 25, never 1925.
    expect(mine?.currency).toBe("KWD");
    expect(mine?.total).toBe("25");
    // …while the count spans ALL currencies.
    expect(mine?.count).toBe(4);
    expect(mine?.otherCurrenciesCount).toBe(2);
  });

  it("breaks a tie on payment count by the larger total", () => {
    const mine = summarizeMyWaqf([
      payment({ currency: "KWD", amount: "10" }),
      payment({ currency: "USD", amount: "500" }),
    ]);
    expect(mine?.currency).toBe("USD");
    expect(mine?.total).toBe("500");
    expect(mine?.otherCurrenciesCount).toBe(1);
  });

  it("excludes rows that are not completed", () => {
    expect(
      summarizeMyWaqf([
        payment({ status: "pending" }),
        payment({ status: "failed" }),
        payment({ status: "refunded" }),
      ]),
    ).toBeNull();

    const mine = summarizeMyWaqf([
      payment({ amount: "10", status: "completed" }),
      payment({ amount: "999", status: "pending" }),
    ]);
    expect(mine?.total).toBe("10");
    expect(mine?.count).toBe(1);
  });

  it("excludes payments that are not tagged for the waqf", () => {
    expect(
      summarizeMyWaqf([
        payment({ target_type: null }),
        payment({ target_type: undefined }),
        payment({ target_type: "zakat" }),
      ]),
    ).toBeNull();

    const mine = summarizeMyWaqf([
      payment({ amount: "10", target_type: "waqf" }),
      payment({ amount: "999", target_type: null, sponsorship_id: "s-1" }),
    ]);
    expect(mine?.total).toBe("10");
    expect(mine?.count).toBe(1);
  });

  it("ignores an unparseable amount without dropping the payment", () => {
    const mine = summarizeMyWaqf([
      payment({ amount: "10" }),
      payment({ amount: "not-a-number" }),
    ]);
    expect(mine?.total).toBe("10");
    expect(mine?.count).toBe(2);
  });
});

describe("validateWaqfAmount", () => {
  it("refuses an empty or blank amount", () => {
    expect(validateWaqfAmount("")).toEqual({ ok: false, reason: "empty" });
    expect(validateWaqfAmount("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses a non-numeric amount", () => {
    expect(validateWaqfAmount("abc")).toEqual({ ok: false, reason: "nan" });
  });

  it("refuses zero and negatives", () => {
    expect(validateWaqfAmount("0")).toEqual({ ok: false, reason: "nonPositive" });
    expect(validateWaqfAmount("-5")).toEqual({
      ok: false,
      reason: "nonPositive",
    });
  });

  it("accepts a positive amount and keeps what the donor typed", () => {
    expect(validateWaqfAmount(" 10.500 ")).toEqual({ ok: true, value: "10.500" });
  });
});

describe("WAQF_PRESETS", () => {
  it("offers four ascending, positive suggestions", () => {
    expect([...WAQF_PRESETS]).toEqual([10, 50, 100, 500]);
    for (const preset of WAQF_PRESETS) expect(preset).toBeGreaterThan(0);
  });
});
