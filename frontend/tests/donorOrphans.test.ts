import { describe, expect, it } from "vitest";

import type { OrphanCardData } from "@/lib/donorOrphans";
import {
  buildOrphanCards,
  compareOrphanCards,
  filterCards,
  needsAttention,
  priorityTier,
  relationshipSignal,
  summarizeImpact,
} from "@/lib/donorOrphans";
import type { MessageRead } from "@/lib/messages";
import type { ReportDonorRead } from "@/lib/reports";
import type { Sponsorship } from "@/lib/sponsorships";

// A fixed "now" keeps every window (30/90 days) deterministic.
const NOW = new Date("2026-08-21T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function sponsorship(over: Partial<Sponsorship>): Sponsorship {
  return {
    id: "s-base",
    code: "SPN",
    donor_id: "d-1",
    orphan_id: "o-base",
    monthly_amount: "30",
    currency: "USD",
    start_date: "2025-01-01",
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "300",
    payments_count: 10,
    next_payment_date: "2026-09-01",
    created_at: "2025-01-01T00:00:00Z",
    donor_code: null,
    donor_name: null,
    orphan_code: "ORF-base",
    orphan_name: "طفل",
    ...over,
  };
}

function report(over: Partial<ReportDonorRead>): ReportDonorRead {
  return {
    id: "r-base",
    orphan_id: "o-base",
    report_type: "monthly",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    summary: null,
    donor_message: null,
    is_milestone: false,
    milestone_label: null,
    status: "published_to_donor",
    created_at: daysAgo(10),
    updated_at: daysAgo(10),
    submitted_at: null,
    partner_approved_at: null,
    org_approved_at: null,
    published_at: daysAgo(10),
    photos_count: 0,
    videos_count: 0,
    documents_count: 0,
    ...over,
  } as ReportDonorRead;
}

function message(over: Partial<MessageRead>): MessageRead {
  return {
    id: "m-base",
    content: "مرحباً",
    created_at: daysAgo(1),
    from_name: "طفل",
    from_role: "orphan",
    is_mine: false,
    is_read: false,
    message_type: "text",
    moderated_at: null,
    moderation_notes: null,
    moderation_status: "approved",
    orphan_code: "ORF-base",
    read_at: null,
    to_name: "كفيل",
    to_role: "donor",
    ...over,
  } as MessageRead;
}

function card(over: Partial<OrphanCardData> & { sponsorship: Sponsorship }): OrphanCardData {
  return { unreadCount: 0, latestUnreadAt: null, latestReport: null, ...over };
}

// One card per priority tier, named after its expected rank.
const OVERDUE = card({
  sponsorship: sponsorship({ id: "s1", orphan_id: "o1", status: "overdue", next_payment_date: daysAgo(40) }),
});
const UNREAD = card({
  sponsorship: sponsorship({ id: "s2", orphan_id: "o2" }),
  unreadCount: 2,
  latestUnreadAt: daysAgo(2),
});
const FRESH_REPORT = card({
  sponsorship: sponsorship({ id: "s3", orphan_id: "o3" }),
  latestReport: report({ orphan_id: "o3", published_at: daysAgo(10) }),
});
const PLAIN_ACTIVE = card({
  sponsorship: sponsorship({ id: "s4", orphan_id: "o4" }),
});
const PAUSED = card({
  sponsorship: sponsorship({ id: "s5", orphan_id: "o5", status: "paused", next_payment_date: null }),
});

const EXPECTED_ORDER = ["s1", "s2", "s3", "s4", "s5"];

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe("priorityTier", () => {
  it("assigns the five tiers of the spec", () => {
    expect(priorityTier(OVERDUE, NOW)).toBe(1);
    expect(priorityTier(UNREAD, NOW)).toBe(2);
    expect(priorityTier(FRESH_REPORT, NOW)).toBe(3);
    expect(priorityTier(PLAIN_ACTIVE, NOW)).toBe(4);
    expect(priorityTier(PAUSED, NOW)).toBe(5);
  });

  it("a report older than 30 days no longer lifts the card", () => {
    const stale = card({
      sponsorship: sponsorship({ id: "s6", orphan_id: "o6" }),
      latestReport: report({ orphan_id: "o6", published_at: daysAgo(45) }),
    });
    expect(priorityTier(stale, NOW)).toBe(4);
  });
});

describe("compareOrphanCards", () => {
  it("sorts every permutation of the five tiers into the same order", () => {
    for (const perm of permutations([OVERDUE, UNREAD, FRESH_REPORT, PLAIN_ACTIVE, PAUSED])) {
      const sorted = [...perm].sort((a, b) => compareOrphanCards(a, b, NOW));
      expect(sorted.map((c) => c.sponsorship.id)).toEqual(EXPECTED_ORDER);
    }
  });

  it("orders inside a tier: oldest overdue first, soonest active payment first", () => {
    const older = card({
      sponsorship: sponsorship({ id: "s-old", orphan_id: "oa", status: "overdue", next_payment_date: daysAgo(90) }),
    });
    expect(compareOrphanCards(older, OVERDUE, NOW)).toBeLessThan(0);

    const sooner = card({
      sponsorship: sponsorship({ id: "s-soon", orphan_id: "ob", next_payment_date: "2026-08-25" }),
    });
    expect(compareOrphanCards(sooner, PLAIN_ACTIVE, NOW)).toBeLessThan(0);
  });
});

describe("buildOrphanCards", () => {
  it("picks the LATEST published report from unsorted input", () => {
    const s = sponsorship({ id: "s1", orphan_id: "o1", orphan_code: "ORF-1" });
    const cards = buildOrphanCards(
      [s],
      [
        report({ id: "r-old", orphan_id: "o1", published_at: daysAgo(80) }),
        report({ id: "r-new", orphan_id: "o1", published_at: daysAgo(3) }),
        report({ id: "r-mid", orphan_id: "o1", published_at: daysAgo(40) }),
        report({ id: "r-unpublished", orphan_id: "o1", published_at: null }),
        report({ id: "r-other-child", orphan_id: "o2", published_at: daysAgo(1) }),
      ],
      [],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.latestReport?.id).toBe("r-new");
  });

  it("counts only unread incoming messages, matched by orphan_code", () => {
    const s = sponsorship({ id: "s1", orphan_id: "o1", orphan_code: "ORF-1" });
    const cards = buildOrphanCards(
      [s],
      [],
      [
        message({ id: "m1", orphan_code: "ORF-1", created_at: daysAgo(5) }),
        message({ id: "m2", orphan_code: "ORF-1", created_at: daysAgo(1) }),
        // The donor's own message and an already-read one don't count.
        message({ id: "m3", orphan_code: "ORF-1", is_mine: true }),
        message({ id: "m4", orphan_code: "ORF-1", is_read: true }),
        message({ id: "m5", orphan_code: "ORF-OTHER" }),
      ],
    );
    expect(cards[0]?.unreadCount).toBe(2);
    expect(cards[0]?.latestUnreadAt).toBe(daysAgo(1));
  });

  it("drops non-live sponsorships", () => {
    const cards = buildOrphanCards(
      [
        sponsorship({ id: "s1", status: "cancelled" }),
        sponsorship({ id: "s2", status: "completed" }),
        sponsorship({ id: "s3", status: "paused" }),
      ],
      [],
      [],
    );
    expect(cards.map((c) => c.sponsorship.id)).toEqual(["s3"]);
  });
});

describe("relationshipSignal", () => {
  it("an unread message beats a recent report", () => {
    const both = card({
      sponsorship: sponsorship({ id: "s1", orphan_id: "o1" }),
      unreadCount: 1,
      latestUnreadAt: daysAgo(1),
      latestReport: report({ orphan_id: "o1", published_at: daysAgo(2) }),
    });
    expect(relationshipSignal(both, NOW)?.kind).toBe("message");
  });

  it("a report older than 90 days yields NO signal (silence, not 'nothing new')", () => {
    const stale = card({
      sponsorship: sponsorship({ id: "s1", orphan_id: "o1" }),
      latestReport: report({ orphan_id: "o1", published_at: daysAgo(120) }),
    });
    expect(relationshipSignal(stale, NOW)).toBeNull();
  });
});

describe("filterCards + needsAttention", () => {
  const all = [OVERDUE, UNREAD, FRESH_REPORT, PLAIN_ACTIVE, PAUSED];

  it("'attention' keeps overdue and unread only", () => {
    expect(
      filterCards(all, "attention", "").map((c) => c.sponsorship.id),
    ).toEqual(["s1", "s2"]);
    expect(needsAttention(PAUSED)).toBe(false);
  });

  it("searches name and code, case-insensitively", () => {
    const named = card({
      sponsorship: sponsorship({ id: "s9", orphan_name: "مريم", orphan_code: "ORF-77" }),
    });
    expect(filterCards([named, PLAIN_ACTIVE], "all", "مري")).toHaveLength(1);
    expect(filterCards([named, PLAIN_ACTIVE], "all", "orf-77")).toHaveLength(1);
    expect(filterCards([named, PLAIN_ACTIVE], "all", "zzz")).toHaveLength(0);
  });
});

describe("summarizeImpact", () => {
  it("never sums across currencies — dominant + a count of others", () => {
    const summary = summarizeImpact(
      [
        sponsorship({ id: "s1", orphan_id: "o1", currency: "KWD", total_paid: "90", monthly_amount: "15" }),
        sponsorship({ id: "s2", orphan_id: "o2", currency: "KWD", total_paid: "60", monthly_amount: "10" }),
        sponsorship({ id: "s3", orphan_id: "o3", currency: "USD", total_paid: "1000", monthly_amount: "50" }),
      ],
      NOW,
    );
    expect(summary?.dominant.currency).toBe("KWD");
    // 90 + 60 KWD only — the 1000 USD never leaks into the total.
    expect(summary?.dominant.totalPaid).toBe(150);
    expect(summary?.dominant.monthlyActive).toBe(25);
    expect(summary?.otherCurrenciesCount).toBe(1);
  });

  it("monthly commitment counts ACTIVE sponsorships only", () => {
    const summary = summarizeImpact(
      [
        sponsorship({ id: "s1", orphan_id: "o1", monthly_amount: "30", status: "active" }),
        sponsorship({ id: "s2", orphan_id: "o2", monthly_amount: "99", status: "paused" }),
        sponsorship({ id: "s3", orphan_id: "o3", monthly_amount: "99", status: "overdue" }),
      ],
      NOW,
    );
    expect(summary?.dominant.monthlyActive).toBe(30);
  });

  it("next payment is the soonest FUTURE date among active sponsorships", () => {
    const summary = summarizeImpact(
      [
        sponsorship({ id: "s1", orphan_id: "o1", next_payment_date: "2026-09-10", orphan_name: "آدم" }),
        sponsorship({ id: "s2", orphan_id: "o2", next_payment_date: "2026-08-25", orphan_name: "مريم" }),
        // Past date (overdue) never becomes "your next payment".
        sponsorship({ id: "s3", orphan_id: "o3", status: "overdue", next_payment_date: daysAgo(10) }),
      ],
      NOW,
    );
    expect(summary?.nextPayment).toEqual({ date: "2026-08-25", orphanName: "مريم" });
  });

  it("no future payment → null (the UI says 'no scheduled payments')", () => {
    const summary = summarizeImpact(
      [sponsorship({ id: "s1", next_payment_date: null })],
      NOW,
    );
    expect(summary?.nextPayment).toBeNull();
  });

  it("returns null with nothing live", () => {
    expect(summarizeImpact([], NOW)).toBeNull();
    expect(summarizeImpact([sponsorship({ status: "cancelled" })], NOW)).toBeNull();
  });
});
