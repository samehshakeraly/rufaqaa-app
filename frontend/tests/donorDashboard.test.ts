import { describe, expect, it } from "vitest";

import {
  buildNewsFeed,
  daysOverdue,
  daysUntil,
  nextScheduledPayment,
  summarizeAttention,
  summarizeYearToDate,
} from "@/lib/donorDashboard";
import type { OrphanCardData } from "@/lib/donorOrphans";
import type { ReportDonorRead } from "@/lib/reports";
import type { PaymentDonorRead } from "@/lib/payments";
import type { Sponsorship } from "@/lib/sponsorships";

// A fixed "now" keeps every window (90 days, calendar year) deterministic.
const NOW = new Date("2026-08-21T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function inDays(n: number): string {
  return new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

let seq = 0;

// NOTE the explicit `in` checks for the nullable date fields: with `??`
// an explicit null in `over` would silently fall back to the default and
// the empty-state tests would assert against the wrong fixture.
function sponsorship(over: Record<string, unknown>): Sponsorship {
  seq += 1;
  return {
    id: `s-${seq}`,
    code: `SPN-${seq}`,
    donor_id: "d-1",
    orphan_id: `o-${seq}`,
    monthly_amount: "30",
    currency: "USD",
    start_date: "2025-01-01",
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "300",
    payments_count: 10,
    next_payment_date: "nextPaymentDate" in over
      ? (over.nextPaymentDate as string | null)
      : inDays(20),
    created_at: "2025-01-01T00:00:00Z",
    donor_code: null,
    donor_name: null,
    orphan_code: `ORF-${seq}`,
    orphan_name: `طفل-${seq}`,
    ...Object.fromEntries(
      Object.entries(over).filter(([k]) => k !== "nextPaymentDate"),
    ),
  } as Sponsorship;
}

function card(
  s: Record<string, unknown>,
  over?: Partial<Omit<OrphanCardData, "sponsorship">>,
): OrphanCardData {
  return {
    sponsorship: sponsorship(s),
    unreadCount: 0,
    latestUnreadAt: null,
    latestReport: null,
    ...over,
  };
}

function report(over: Partial<ReportDonorRead>): ReportDonorRead {
  return {
    id: `r-${++seq}`,
    orphan_id: "o-base",
    milestone_label: null,
    published_at: daysAgo(10),
    ...over,
  } as ReportDonorRead;
}

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

describe("summarizeAttention", () => {
  it("sorts overdue cards oldest-late first (next_payment_date ascending)", () => {
    const recent = card({ status: "overdue", nextPaymentDate: daysAgo(5).slice(0, 10) });
    const oldest = card({ status: "overdue", nextPaymentDate: daysAgo(60).slice(0, 10) });
    const middle = card({ status: "overdue", nextPaymentDate: daysAgo(30).slice(0, 10) });
    const a = summarizeAttention([recent, oldest, middle]);
    expect(a.overdue.map((c) => c.sponsorship.id)).toEqual([
      oldest.sponsorship.id,
      middle.sponsorship.id,
      recent.sponsorship.id,
    ]);
    expect(a.signals).toBe(1);
  });

  it("an overdue child carrying a message counts ONCE (overdue), but its messages stay in unreadTotal", () => {
    const both = card(
      { status: "overdue", nextPaymentDate: daysAgo(10).slice(0, 10) },
      { unreadCount: 2, latestUnreadAt: daysAgo(1) },
    );
    const messageOnly = card({}, { unreadCount: 3, latestUnreadAt: daysAgo(2) });
    const a = summarizeAttention([both, messageOnly]);
    expect(a.overdue).toHaveLength(1);
    expect(a.unread.map((c) => c.sponsorship.id)).toEqual([
      messageOnly.sponsorship.id,
    ]);
    expect(a.unreadTotal).toBe(5);
    expect(a.signals).toBe(2);
  });

  it("unread cards order newest-message first", () => {
    const older = card({}, { unreadCount: 1, latestUnreadAt: daysAgo(9) });
    const newer = card({}, { unreadCount: 1, latestUnreadAt: daysAgo(1) });
    const a = summarizeAttention([older, newer]);
    expect(a.unread.map((c) => c.sponsorship.id)).toEqual([
      newer.sponsorship.id,
      older.sponsorship.id,
    ]);
  });

  it("no overdue and no unread → zero signals", () => {
    const a = summarizeAttention([card({}), card({ status: "paused", nextPaymentDate: null })]);
    expect(a.signals).toBe(0);
    expect(a.unreadTotal).toBe(0);
  });
});

describe("daysOverdue / daysUntil", () => {
  it("daysOverdue floors and never goes negative", () => {
    const late = card({ status: "overdue", nextPaymentDate: daysAgo(10).slice(0, 10) });
    expect(daysOverdue(late, NOW)).toBe(10);
    const future = card({ status: "overdue", nextPaymentDate: inDays(3) });
    expect(daysOverdue(future, NOW)).toBe(0);
  });

  it("both return null for a missing or invalid date", () => {
    expect(daysOverdue(card({ nextPaymentDate: null }), NOW)).toBeNull();
    expect(daysOverdue(card({ nextPaymentDate: "not-a-date" }), NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
  });

  it("daysUntil ceils and never goes negative", () => {
    expect(daysUntil(inDays(3), NOW)).toBe(3);
    expect(daysUntil(daysAgo(3).slice(0, 10), NOW)).toBe(0);
  });
});

describe("buildNewsFeed", () => {
  it("merges message + report items, newest first, capped at the limit", () => {
    const cards = [
      card({}, { unreadCount: 1, latestUnreadAt: daysAgo(1) }),
      card({}, { latestReport: report({ published_at: daysAgo(2) }) }),
      card({}, { unreadCount: 1, latestUnreadAt: daysAgo(3) }),
      card({}, { latestReport: report({ published_at: daysAgo(4) }) }),
      card({}, { unreadCount: 1, latestUnreadAt: daysAgo(5) }),
    ];
    const feed = buildNewsFeed(cards, NOW);
    expect(feed).toHaveLength(4);
    expect(feed.map((i) => i.kind)).toEqual([
      "message",
      "report",
      "message",
      "report",
    ]);
  });

  it("one child can contribute BOTH a message and a report — two events", () => {
    const both = card(
      {},
      {
        unreadCount: 1,
        latestUnreadAt: daysAgo(1),
        latestReport: report({ published_at: daysAgo(2), milestone_label: "أتمّ حفظ جزء عمّ" }),
      },
    );
    const feed = buildNewsFeed([both], NOW);
    expect(feed).toHaveLength(2);
    expect(feed[0]?.kind).toBe("message");
    expect(feed[1]?.kind).toBe("report");
    expect(feed[1]?.kind === "report" && feed[1].milestoneLabel).toBe(
      "أتمّ حفظ جزء عمّ",
    );
  });

  it("drops reports older than 90 days", () => {
    const stale = card({}, { latestReport: report({ published_at: daysAgo(91) }) });
    const fresh = card({}, { latestReport: report({ published_at: daysAgo(89) }) });
    const feed = buildNewsFeed([stale, fresh], NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0]?.card.sponsorship.id).toBe(fresh.sponsorship.id);
  });

  it("orders totally and stably regardless of input order", () => {
    const a = card({}, { unreadCount: 1, latestUnreadAt: daysAgo(1) });
    const b = card({}, { latestReport: report({ published_at: daysAgo(2) }) });
    const c = card({}, { unreadCount: 1, latestUnreadAt: daysAgo(3) });
    const forward = buildNewsFeed([a, b, c], NOW);
    const backward = buildNewsFeed([c, b, a], NOW);
    expect(forward.map((i) => `${i.kind}:${i.card.sponsorship.id}`)).toEqual(
      backward.map((i) => `${i.kind}:${i.card.sponsorship.id}`),
    );
  });
});

describe("nextScheduledPayment", () => {
  it("returns the soonest future active payment", () => {
    const near = sponsorship({ nextPaymentDate: inDays(5) });
    const far = sponsorship({ nextPaymentDate: inDays(25) });
    expect(nextScheduledPayment([far, near], NOW)?.id).toBe(near.id);
  });

  it("REGRESSION (PR-D06): paused never produces an upcoming payment", () => {
    const paused = sponsorship({ status: "paused", nextPaymentDate: inDays(5) });
    expect(nextScheduledPayment([paused], NOW)).toBeNull();
  });

  it("overdue is excluded too — its date belongs to the attention bar", () => {
    const overdue = sponsorship({ status: "overdue", nextPaymentDate: inDays(5) });
    expect(nextScheduledPayment([overdue], NOW)).toBeNull();
  });

  it("past dates and missing dates never win", () => {
    const past = sponsorship({ nextPaymentDate: daysAgo(5).slice(0, 10) });
    const none = sponsorship({ nextPaymentDate: null });
    expect(nextScheduledPayment([past, none], NOW)).toBeNull();
  });
});

describe("summarizeYearToDate", () => {
  it("counts only COMPLETED payments of the current calendar year", () => {
    const ytd = summarizeYearToDate(
      [
        payment({ completed_at: "2026-03-01T10:00:00Z" }),
        payment({ status: "pending", completed_at: null, initiated_at: "2026-04-01T10:00:00Z" }),
        payment({ status: "failed", completed_at: null, initiated_at: "2026-05-01T10:00:00Z" }),
        payment({ completed_at: "2025-11-01T10:00:00Z" }), // last year
      ],
      NOW,
    );
    expect(ytd).toEqual({
      year: 2026,
      currency: "KWD",
      total: 45,
      count: 1,
      otherCurrenciesCount: 0,
    });
  });

  it("falls back to initiated_at when completed_at is missing", () => {
    const ytd = summarizeYearToDate(
      [payment({ completed_at: null, initiated_at: "2026-02-01T10:00:00Z" })],
      NOW,
    );
    expect(ytd?.count).toBe(1);
  });

  it("NEVER sums across currencies — dominant by count, ties by larger total", () => {
    const ytd = summarizeYearToDate(
      [
        payment({ currency: "KWD", amount: "10.000", completed_at: "2026-01-05T00:00:00Z" }),
        payment({ currency: "USD", amount: "500", completed_at: "2026-02-05T00:00:00Z" }),
      ],
      NOW,
    );
    // One payment each: the tie goes to the larger total (USD 500).
    expect(ytd?.currency).toBe("USD");
    expect(ytd?.total).toBe(500);
    // All completed payments counted, but never a merged money total.
    expect(ytd?.count).toBe(2);
    expect(ytd?.otherCurrenciesCount).toBe(1);
  });

  it("returns null when the year holds no completed payment", () => {
    expect(summarizeYearToDate([], NOW)).toBeNull();
    expect(
      summarizeYearToDate(
        [payment({ completed_at: "2025-03-01T10:00:00Z" })],
        NOW,
      ),
    ).toBeNull();
  });

  it("folds raw statuses — chargeback/disputed are not completed", () => {
    expect(
      summarizeYearToDate(
        [
          payment({ status: "chargeback", completed_at: "2026-03-01T10:00:00Z" }),
          payment({ status: "disputed", completed_at: "2026-03-02T10:00:00Z" }),
        ],
        NOW,
      ),
    ).toBeNull();
  });
});
