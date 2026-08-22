import { describe, expect, it } from "vitest";

import { foldPaymentStatus } from "@/lib/paymentStatus";

// The system's nine payment statuses fold to five donor-facing groups.
// The operational vocabulary (dispute, chargeback) must never surface —
// both land on the calm "underReview".
describe("foldPaymentStatus", () => {
  it("folds all nine system statuses", () => {
    expect(foldPaymentStatus("completed")).toBe("completed");
    expect(foldPaymentStatus("pending")).toBe("inProgress");
    expect(foldPaymentStatus("processing")).toBe("inProgress");
    expect(foldPaymentStatus("on_hold")).toBe("inProgress");
    expect(foldPaymentStatus("failed")).toBe("notCompleted");
    expect(foldPaymentStatus("refunded")).toBe("refunded");
    expect(foldPaymentStatus("partially_refunded")).toBe("refunded");
    expect(foldPaymentStatus("chargeback")).toBe("underReview");
    expect(foldPaymentStatus("disputed")).toBe("underReview");
  });

  it("folds a status this build doesn't know to the neutral inProgress", () => {
    expect(foldPaymentStatus("some_future_status")).toBe("inProgress");
    expect(foldPaymentStatus("")).toBe("inProgress");
  });
});
