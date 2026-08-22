import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/csv";
import {
  bankReferenceOf,
  buildPaymentRows,
  buildStatementCsv,
  countByStatus,
  effectiveDate,
  failedPaymentRows,
  filterPaymentRows,
  paymentAbout,
  paymentYears,
  pendingSponsorships,
  rowsInYear,
  showsBankReference,
  showsReceiptNumber,
  summarizeYear,
  type StatementLabels,
} from "@/lib/donorPayments";
import type { PaymentDonorRead } from "@/lib/payments";
import type { Sponsorship } from "@/lib/sponsorships";

let seq = 0;

function payment(over: Partial<PaymentDonorRead>): PaymentDonorRead {
  seq += 1;
  return {
    id: `p-${seq}`,
    code: `PAY-${1000 + seq}`,
    amount: "45.000",
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
    gateway_transaction_id: null,
    bank_reference: null,
    orphan_name: null,
    orphan_code: null,
    ...over,
  };
}

function sponsorship(over: Partial<Sponsorship>): Sponsorship {
  seq += 1;
  return {
    id: `s-${seq}`,
    code: `SPN-${seq}`,
    donor_id: "d-1",
    orphan_id: `o-${seq}`,
    monthly_amount: "45.000",
    currency: "KWD",
    start_date: "2025-06-01",
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "450.000",
    payments_count: 10,
    next_payment_date: null,
    created_at: "2025-06-01T00:00:00Z",
    donor_code: "DNR-1",
    donor_name: "كفيل",
    orphan_code: `ORF-${seq}`,
    orphan_name: `طفل-${seq}`,
    ...over,
  };
}

describe("buildPaymentRows", () => {
  it("joins each payment to its sponsorship and folds the status", () => {
    const s = sponsorship({ id: "s-a", orphan_name: "أحمد" });
    const rows = buildPaymentRows(
      [
        payment({ sponsorship_id: "s-a", status: "failed" }),
        payment({ sponsorship_id: null }),
        payment({ sponsorship_id: "s-gone" }),
      ],
      [s],
    );
    expect(rows[0]?.sponsorship?.orphan_name).toBe("أحمد");
    expect(rows[0]?.status).toBe("notCompleted");
    // General donation and an unknown (archived) sponsorship both join to null.
    expect(rows[1]?.sponsorship).toBeNull();
    expect(rows[2]?.sponsorship).toBeNull();
  });
});

describe("effectiveDate", () => {
  it("prefers completed_at and falls back to initiated_at", () => {
    expect(
      effectiveDate(payment({ completed_at: "2026-05-05T00:00:00Z" })),
    ).toBe("2026-05-05T00:00:00Z");
    expect(
      effectiveDate(
        payment({ completed_at: null, initiated_at: "2026-01-02T00:00:00Z" }),
      ),
    ).toBe("2026-01-02T00:00:00Z");
  });
});

describe("filterPaymentRows + countByStatus", () => {
  const s = sponsorship({ id: "s-a", orphan_name: "لُجين" });
  const rows = buildPaymentRows(
    [
      payment({ code: "PAY-111", status: "completed", sponsorship_id: "s-a" }),
      payment({ code: "PAY-222", status: "failed" }),
      payment({ code: "PAY-333", status: "processing" }),
    ],
    [s],
  );

  it("filters by folded status chip", () => {
    expect(filterPaymentRows(rows, "notCompleted", "")).toHaveLength(1);
    expect(filterPaymentRows(rows, "all", "")).toHaveLength(3);
    expect(filterPaymentRows(rows, "refunded", "")).toHaveLength(0);
  });

  it("searches the payment code and the child's name", () => {
    expect(filterPaymentRows(rows, "all", "pay-222")).toHaveLength(1);
    expect(filterPaymentRows(rows, "all", "لُجين")).toHaveLength(1);
    expect(filterPaymentRows(rows, "all", "غير موجود")).toHaveLength(0);
  });

  it("searches the child's name from the payment itself (no sponsorship)", () => {
    const unmatched = buildPaymentRows(
      [payment({ code: "PAY-444", orphan_id: "o-x", orphan_name: "سارة" })],
      [],
    );
    expect(filterPaymentRows(unmatched, "all", "سارة")).toHaveLength(1);
  });

  it("counts rows per chip (zero-count chips get hidden by the toolbar)", () => {
    const counts = countByStatus(rows);
    expect(counts.all).toBe(3);
    expect(counts.completed).toBe(1);
    expect(counts.notCompleted).toBe(1);
    expect(counts.inProgress).toBe(1);
    expect(counts.refunded).toBe(0);
    expect(counts.underReview).toBe(0);
  });
});

describe("paymentYears + rowsInYear", () => {
  const rows = buildPaymentRows(
    [
      payment({ completed_at: "2026-02-01T00:00:00Z" }),
      payment({ completed_at: null, initiated_at: "2025-12-30T00:00:00Z" }),
      payment({ completed_at: "2024-07-01T00:00:00Z" }),
      payment({ completed_at: "2026-06-01T00:00:00Z" }),
    ],
    [],
  );

  it("extracts distinct years from the effective dates, newest first", () => {
    expect(paymentYears(rows)).toEqual([2026, 2025, 2024]);
  });

  it("narrows to one year, or keeps everything for 'all'", () => {
    expect(rowsInYear(rows, 2026)).toHaveLength(2);
    expect(rowsInYear(rows, 2024)).toHaveLength(1);
    expect(rowsInYear(rows, "all")).toHaveLength(4);
  });
});

describe("summarizeYear", () => {
  it("counts and sums only COMPLETED payments of the selected year", () => {
    const rows = buildPaymentRows(
      [
        payment({ amount: "45.000", completed_at: "2026-01-01T00:00:00Z" }),
        payment({ amount: "40.000", completed_at: "2026-02-01T00:00:00Z" }),
        payment({
          amount: "99.000",
          status: "failed",
          completed_at: null,
          initiated_at: "2026-03-01T00:00:00Z",
        }),
        payment({ amount: "30.000", completed_at: "2025-01-01T00:00:00Z" }),
      ],
      [],
    );
    const summary = summarizeYear(rows, 2026);
    expect(summary).not.toBeNull();
    expect(summary?.dominant).toEqual({ currency: "KWD", total: 85, count: 2 });
    expect(summary?.otherCurrenciesCount).toBe(0);
    expect(summary?.completedCount).toBe(2);
  });

  it("NEVER sums mixed currencies — dominant bucket + a count of the others", () => {
    const rows = buildPaymentRows(
      [
        payment({ amount: "45.000", currency: "KWD" }),
        payment({ amount: "40.000", currency: "KWD" }),
        payment({ amount: "100.00", currency: "USD" }),
      ],
      [],
    );
    const summary = summarizeYear(rows, 2026);
    expect(summary?.dominant.currency).toBe("KWD");
    expect(summary?.dominant.total).toBe(85); // the USD 100 must not leak in
    expect(summary?.otherCurrenciesCount).toBe(1);
    expect(summary?.completedCount).toBe(3);
  });

  it("returns null when the year holds no completed payment", () => {
    const rows = buildPaymentRows([payment({ status: "failed" })], []);
    expect(summarizeYear(rows, 2026)).toBeNull();
  });
});

const LABELS: StatementLabels = {
  headers: [
    "التاريخ",
    "رقم العملية",
    "عن",
    "المبلغ",
    "العملة",
    "الطريقة",
    "الحالة",
    "رقم الإيصال",
    "مرجع البنك",
    "مرجع بوابة الدفع",
  ],
  generalDonation: "تبرّع عام",
  sponsorshipOf: (name) => `كفالة ${name}`,
  donationFor: (name) => `تبرّع لـ ${name}`,
  methodLabel: (m) => (m === "credit_card" ? "بطاقة ائتمان" : m),
  statusLabel: (s) => (s === "completed" ? "تمّت" : s),
};

describe("buildStatementCsv", () => {
  it("writes the header row then one row per payment", () => {
    const s = sponsorship({ id: "s-a", code: "SPN-9", orphan_name: "أحمد" });
    const csv = buildStatementCsv(
      buildPaymentRows(
        [
          payment({
            code: "PAY-1",
            sponsorship_id: "s-a",
            completed_at: "2026-02-03T10:00:00Z",
            receipt_number: "RC-1",
          }),
          payment({ code: "PAY-2" }),
        ],
        [s],
      ),
      LABELS,
    );
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(LABELS.headers);
    expect(rows[1]).toEqual([
      "2026-02-03",
      "PAY-1",
      "كفالة أحمد (SPN-9)",
      "45.000",
      "KWD",
      "بطاقة ائتمان",
      "تمّت",
      "RC-1",
      "",
      "",
    ]);
    expect(rows[2]?.[2]).toBe("تبرّع عام");
    expect(rows[2]?.[7]).toBe(""); // no receipt number
  });

  it("the about column follows the three-step precedence", () => {
    const s = sponsorship({ id: "s-a", code: "SPN-9", orphan_name: "أحمد" });
    const csv = buildStatementCsv(
      buildPaymentRows(
        [
          payment({ sponsorship_id: "s-a", orphan_name: "أحمد", orphan_code: "ORF-1" }),
          payment({ orphan_id: "o-2", orphan_name: "سارة", orphan_code: "ORF-2" }),
          payment({}),
        ],
        [s],
      ),
      LABELS,
    );
    const rows = parseCsv(csv);
    expect(rows[1]?.[2]).toBe("كفالة أحمد (SPN-9)");
    expect(rows[2]?.[2]).toBe("تبرّع لـ سارة (ORF-2)");
    expect(rows[3]?.[2]).toBe("تبرّع عام");
  });

  it("carries bank_reference and gateway_transaction_id columns", () => {
    const csv = buildStatementCsv(
      buildPaymentRows(
        [
          payment({
            status: "failed",
            bank_reference: "BNK-REF-9",
            gateway_transaction_id: "GW-TXN-9",
          }),
        ],
        [],
      ),
      LABELS,
    );
    const rows = parseCsv(csv);
    expect(rows[1]?.[8]).toBe("BNK-REF-9");
    expect(rows[1]?.[9]).toBe("GW-TXN-9");
  });

  it("escapes commas and quotes inside values (round-trips through parseCsv)", () => {
    const s = sponsorship({
      id: "s-a",
      code: "SPN-9",
      orphan_name: 'أحمد، "الصغير"',
    });
    const csv = buildStatementCsv(
      buildPaymentRows([payment({ sponsorship_id: "s-a" })], [s]),
      { ...LABELS, sponsorshipOf: (name) => `كفالة ${name}, وقف` },
    );
    // The raw text is quoted…
    expect(csv).toContain('"كفالة أحمد، ""الصغير"", وقف (SPN-9)"');
    // …and parses back to the exact original value.
    const rows = parseCsv(csv);
    expect(rows[1]?.[2]).toBe('كفالة أحمد، "الصغير", وقف (SPN-9)');
  });
});

describe("paymentAbout — three-step naming precedence", () => {
  it("a matched sponsorship wins", () => {
    const s = sponsorship({ id: "s-a", code: "SPN-9", orphan_name: "أحمد" });
    const [row] = buildPaymentRows(
      [payment({ sponsorship_id: "s-a", orphan_name: "غيره", orphan_code: "ORF-1" })],
      [s],
    );
    expect(paymentAbout(row!)).toEqual({
      kind: "sponsorship",
      name: "أحمد",
      code: "SPN-9",
    });
  });

  it("falls back to the payment's own child when no sponsorship matches", () => {
    const [row] = buildPaymentRows(
      [payment({ orphan_id: "o-1", orphan_name: "سارة", orphan_code: "ORF-2" })],
      [],
    );
    expect(paymentAbout(row!)).toEqual({ kind: "orphan", name: "سارة", code: "ORF-2" });
  });

  it("a payment with no child at all is a general donation", () => {
    const [row] = buildPaymentRows([payment({})], []);
    expect(paymentAbout(row!)).toEqual({ kind: "general" });
  });
});

describe("reference-number rules", () => {
  it("bankReferenceOf prefers bank_reference and falls back to the gateway id", () => {
    expect(
      bankReferenceOf(payment({ bank_reference: "B-1", gateway_transaction_id: "G-1" })),
    ).toBe("B-1");
    expect(bankReferenceOf(payment({ gateway_transaction_id: "G-1" }))).toBe("G-1");
    expect(bankReferenceOf(payment({}))).toBeNull();
  });

  it("the bank reference shows only on failed / under-review / refunded rows", () => {
    const make = (status: string) =>
      buildPaymentRows([payment({ status, bank_reference: "B-1" })], [])[0]!;
    expect(showsBankReference(make("failed"))).toBe(true);
    expect(showsBankReference(make("disputed"))).toBe(true);
    expect(showsBankReference(make("refunded"))).toBe(true);
    expect(showsBankReference(make("completed"))).toBe(false);
    expect(showsBankReference(make("processing"))).toBe(false);
  });

  it("…and never without a value to show", () => {
    const [row] = buildPaymentRows([payment({ status: "failed" })], []);
    expect(showsBankReference(row!)).toBe(false);
  });

  it("the receipt number shows only on a completed row that has one", () => {
    const make = (over: Partial<PaymentDonorRead>) =>
      buildPaymentRows([payment(over)], [])[0]!;
    expect(showsReceiptNumber(make({ receipt_number: "RC-1" }))).toBe(true);
    expect(showsReceiptNumber(make({}))).toBe(false);
    expect(
      showsReceiptNumber(make({ status: "failed", receipt_number: "RC-1" })),
    ).toBe(false);
  });
});

describe("needs-completing inputs", () => {
  it("pendingSponsorships keeps only pending rows that can link to checkout", () => {
    const pending = sponsorship({ status: "pending" });
    const noCode = sponsorship({ status: "pending", orphan_code: null });
    const active = sponsorship({ status: "active" });
    expect(pendingSponsorships([pending, noCode, active])).toEqual([pending]);
  });

  it("failedPaymentRows keeps only failed payments", () => {
    const rows = buildPaymentRows(
      [payment({ status: "failed" }), payment({ status: "completed" })],
      [],
    );
    expect(failedPaymentRows(rows)).toHaveLength(1);
    expect(failedPaymentRows(rows)[0]?.payment.status).toBe("failed");
  });
});
