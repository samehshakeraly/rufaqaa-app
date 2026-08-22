/** Pure logic behind the donor dashboard's "today" screen (PR-D01).
 *
 * The dashboard reads the same four donor-scoped endpoints the portal
 * already has (sponsorships, reports, messages, payments) and reuses
 * `buildOrphanCards` from `@/lib/donorOrphans` for the join — nothing
 * here re-merges data. Everything is a pure function of its inputs
 * (`now` is always a parameter, never read from the clock) so ordering
 * and windowing are unit-testable in isolation. */

import type { OrphanCardData } from "./donorOrphans";
import { REPORT_SIGNAL_WINDOW_DAYS } from "./donorOrphans";
import type { PaymentDonorRead } from "./payments";
import { foldPaymentStatus } from "./paymentStatus";
import type { Sponsorship } from "./sponsorships";

const DAY_MS = 24 * 60 * 60 * 1000;

function time(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

/** Ascending sort where missing/unparseable dates go last. */
function byDateAsc(a: string | null, b: string | null): number {
  const ta = time(a);
  const tb = time(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

// ── Attention bar ────────────────────────────────────────────────────

export interface AttentionSummary {
  /** Overdue sponsorships, longest-overdue first (next_payment_date
   * ascending). */
  overdue: OrphanCardData[];
  /** Cards carrying unread messages, newest message first. A child who
   * is ALSO overdue is not listed here — one action per child, and the
   * renewal wins — but their messages still count in `unreadTotal`. */
  unread: OrphanCardData[];
  /** Unread messages across ALL cards, overdue children included. */
  unreadTotal: number;
  /** How many of the two signals (overdue / unread) are present. */
  signals: 0 | 1 | 2;
}

export function summarizeAttention(cards: OrphanCardData[]): AttentionSummary {
  const overdue = cards
    .filter((c) => c.sponsorship.status === "overdue")
    .sort(
      (a, b) =>
        byDateAsc(a.sponsorship.next_payment_date, b.sponsorship.next_payment_date) ||
        a.sponsorship.id.localeCompare(b.sponsorship.id),
    );
  const unread = cards
    .filter((c) => c.unreadCount > 0 && c.sponsorship.status !== "overdue")
    .sort(
      (a, b) =>
        -byDateAsc(a.latestUnreadAt, b.latestUnreadAt) ||
        a.sponsorship.id.localeCompare(b.sponsorship.id),
    );
  const unreadTotal = cards.reduce((sum, c) => sum + c.unreadCount, 0);
  const signals = ((overdue.length > 0 ? 1 : 0) +
    (unread.length > 0 ? 1 : 0)) as 0 | 1 | 2;
  return { overdue, unread, unreadTotal, signals };
}

/** Whole days a card's payment is late. Null when there is no valid
 * next_payment_date; otherwise floored, and never negative. */
export function daysOverdue(card: OrphanCardData, now: Date): number | null {
  const t = time(card.sponsorship.next_payment_date);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** Whole days until a future date (ceil). Null for an invalid date;
 * never negative — a passed date reads as "today", not "-3 days". */
export function daysUntil(date: string, now: Date): number | null {
  const t = time(date);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

// ── Children news feed ───────────────────────────────────────────────

/** One timeline row. A single child may contribute BOTH a message item
 * and a report item — they are different events. */
export type NewsItem =
  | { kind: "message"; at: string; card: OrphanCardData }
  | {
      kind: "report";
      at: string;
      card: OrphanCardData;
      milestoneLabel: string | null;
    };

/** The merged "what reached you about your children" timeline:
 * a message item per card with unread messages, a report item per card
 * whose newest report published within the signal window. Descending by
 * date, then orphan id, then kind — a stable total order — capped at
 * `limit`. */
export function buildNewsFeed(
  cards: OrphanCardData[],
  now: Date,
  limit = 4,
): NewsItem[] {
  const items: NewsItem[] = [];
  for (const card of cards) {
    if (card.unreadCount > 0 && card.latestUnreadAt) {
      items.push({ kind: "message", at: card.latestUnreadAt, card });
    }
    const published = card.latestReport?.published_at;
    if (published) {
      const age = now.getTime() - time(published);
      if (age >= 0 && age <= REPORT_SIGNAL_WINDOW_DAYS * DAY_MS) {
        items.push({
          kind: "report",
          at: published,
          card,
          milestoneLabel: card.latestReport?.milestone_label ?? null,
        });
      }
    }
  }
  items.sort(
    (a, b) =>
      -byDateAsc(a.at, b.at) ||
      a.card.sponsorship.orphan_id.localeCompare(b.card.sponsorship.orphan_id) ||
      a.kind.localeCompare(b.kind),
  );
  return items.slice(0, limit);
}

// ── Next scheduled payment ───────────────────────────────────────────

/** The soonest FUTURE next_payment_date — for "active" sponsorships
 * ONLY. paused and overdue are deliberately excluded: a paused
 * sponsorship showing an upcoming charge was the PR-D06 regression, and
 * an overdue one belongs to the attention bar, not here. */
export function nextScheduledPayment(
  sponsorships: Sponsorship[],
  now: Date,
): Sponsorship | null {
  let best: Sponsorship | null = null;
  for (const s of sponsorships) {
    if (s.status !== "active" || !s.next_payment_date) continue;
    const t = time(s.next_payment_date);
    if (Number.isNaN(t) || t < now.getTime()) continue;
    if (
      !best ||
      t < time(best.next_payment_date) ||
      (t === time(best.next_payment_date) && s.id.localeCompare(best.id) < 0)
    ) {
      best = s;
    }
  }
  return best;
}

// ── Year-to-date giving ──────────────────────────────────────────────

export interface YearToDate {
  /** The calendar year of `now`. */
  year: number;
  /** Dominant currency: most completed payments, ties → larger total. */
  currency: string;
  /** Total of the year's completed payments in the dominant currency —
   * amounts in other currencies are NEVER summed into it. */
  total: number;
  /** Completed payments this year, across ALL currencies. */
  count: number;
  otherCurrenciesCount: number;
}

/** What this calendar year's COMPLETED payments add up to. Statuses go
 * through `foldPaymentStatus` — raw statuses are operational vocabulary
 * this module never interprets directly. Null when the year holds no
 * completed payment. */
export function summarizeYearToDate(
  payments: PaymentDonorRead[],
  now: Date,
): YearToDate | null {
  const year = now.getFullYear();
  const buckets = new Map<string, { currency: string; total: number; count: number }>();
  let count = 0;
  for (const p of payments) {
    if (foldPaymentStatus(p.status) !== "completed") continue;
    const at = new Date(p.completed_at ?? p.initiated_at);
    if (Number.isNaN(at.getTime()) || at.getFullYear() !== year) continue;
    count += 1;
    const bucket = buckets.get(p.currency) ?? {
      currency: p.currency,
      total: 0,
      count: 0,
    };
    bucket.count += 1;
    const amount = Number(p.amount);
    if (Number.isFinite(amount)) bucket.total += amount;
    buckets.set(p.currency, bucket);
  }

  const ranked = [...buckets.values()].sort(
    (a, b) =>
      b.count - a.count ||
      b.total - a.total ||
      a.currency.localeCompare(b.currency),
  );
  const dominant = ranked[0];
  if (!dominant) return null;

  return {
    year,
    currency: dominant.currency,
    total: dominant.total,
    count,
    otherCurrenciesCount: ranked.length - 1,
  };
}
