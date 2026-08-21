/** Pure merge + priority logic behind the donor "My Orphans" page (PR-D06).
 *
 * The page joins three donor-scoped endpoints the app already has —
 * /me/sponsorships, /me/reports and /donor/me/messages — entirely on the
 * client: sponsorships carry both `orphan_id` (joins reports) and
 * `orphan_code` (joins messages), so no new backend surface is needed.
 *
 * Everything here is a pure function of its inputs (`now` is always a
 * parameter, never read from the clock) so the ordering and merge rules
 * are unit-testable in isolation. */

import type { MessageRead } from "./messages";
import type { ReportDonorRead } from "./reports";
import type { Sponsorship } from "./sponsorships";

/** Statuses that count as a live relationship — same set the page always
 * rendered. Cancelled/completed/transferred stay off this screen. */
export const LIVE_STATUSES = new Set(["active", "paused", "overdue"]);

/** A report older than this no longer counts as "news" in the card. */
export const REPORT_SIGNAL_WINDOW_DAYS = 90;

/** A report younger than this lifts the card into the priority tier. */
export const REPORT_PRIORITY_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One card = one live sponsorship, enriched with what the relationship
 * has to say right now. */
export interface OrphanCardData {
  sponsorship: Sponsorship;
  /** Approved, unread, incoming messages from this child. */
  unreadCount: number;
  /** `created_at` of the newest unread message, if any. */
  latestUnreadAt: string | null;
  /** Newest published report for this child, if any. */
  latestReport: ReportDonorRead | null;
}

/** The single "relationship" signal a card may show — at most one, in
 * strict order: unread message beats recent report beats silence. */
export type RelationshipSignal =
  | { kind: "message"; at: string }
  | { kind: "report"; at: string; milestoneLabel: string | null };

function time(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

function isUnreadIncoming(m: MessageRead): boolean {
  return !m.is_mine && !m.is_read;
}

/** Join sponsorships × reports × messages into card data.
 *
 * Reports and messages are progressive enhancements: pass `[]` when
 * their fetch failed and every card still renders, just without a
 * relationship line. Handles unsorted inputs. */
export function buildOrphanCards(
  sponsorships: Sponsorship[],
  reports: ReportDonorRead[],
  messages: MessageRead[],
): OrphanCardData[] {
  const live = sponsorships.filter(
    (s) => LIVE_STATUSES.has(s.status) && s.orphan_id,
  );

  const reportsByOrphan = new Map<string, ReportDonorRead>();
  for (const r of reports) {
    if (!r.published_at) continue;
    const prev = reportsByOrphan.get(r.orphan_id);
    if (!prev || time(r.published_at) > time(prev.published_at)) {
      reportsByOrphan.set(r.orphan_id, r);
    }
  }

  const unreadByCode = new Map<string, { count: number; latestAt: string }>();
  for (const m of messages) {
    if (!m.orphan_code || !isUnreadIncoming(m)) continue;
    const prev = unreadByCode.get(m.orphan_code);
    if (!prev) {
      unreadByCode.set(m.orphan_code, { count: 1, latestAt: m.created_at });
    } else {
      prev.count += 1;
      if (time(m.created_at) > time(prev.latestAt)) {
        prev.latestAt = m.created_at;
      }
    }
  }

  return live.map((s) => {
    const unread = s.orphan_code ? unreadByCode.get(s.orphan_code) : undefined;
    return {
      sponsorship: s,
      unreadCount: unread?.count ?? 0,
      latestUnreadAt: unread?.latestAt ?? null,
      latestReport: reportsByOrphan.get(s.orphan_id) ?? null,
    };
  });
}

/** The one signal the card's relationship box shows, or null for no box
 * at all (never an explicit "nothing new"). */
export function relationshipSignal(
  card: OrphanCardData,
  now: Date,
): RelationshipSignal | null {
  if (card.unreadCount > 0 && card.latestUnreadAt) {
    return { kind: "message", at: card.latestUnreadAt };
  }
  const published = card.latestReport?.published_at;
  if (published) {
    const age = now.getTime() - time(published);
    if (age >= 0 && age <= REPORT_SIGNAL_WINDOW_DAYS * DAY_MS) {
      return {
        kind: "report",
        at: published,
        milestoneLabel: card.latestReport?.milestone_label ?? null,
      };
    }
  }
  return null;
}

/** Default-order priority tier (1 = most urgent):
 * 1 overdue · 2 unread message · 3 report ≤30 days · 4 active · 5 paused. */
export function priorityTier(card: OrphanCardData, now: Date): 1 | 2 | 3 | 4 | 5 {
  const s = card.sponsorship;
  if (s.status === "overdue") return 1;
  if (card.unreadCount > 0) return 2;
  const published = card.latestReport?.published_at;
  if (published) {
    const age = now.getTime() - time(published);
    if (age >= 0 && age <= REPORT_PRIORITY_WINDOW_DAYS * DAY_MS) return 3;
  }
  return s.status === "paused" ? 5 : 4;
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

/** The default "priority" comparator. Within a tier:
 * overdue → oldest missed payment first; unread → newest message first;
 * recent report → newest first; active → soonest next payment first;
 * paused → newest start first. Ends on name + id so it is total. */
export function compareOrphanCards(
  a: OrphanCardData,
  b: OrphanCardData,
  now: Date,
): number {
  const tierA = priorityTier(a, now);
  const tierB = priorityTier(b, now);
  if (tierA !== tierB) return tierA - tierB;

  let cmp = 0;
  switch (tierA) {
    case 1: // longest overdue first = earliest missed next_payment_date
      cmp = byDateAsc(a.sponsorship.next_payment_date, b.sponsorship.next_payment_date);
      break;
    case 2: // newest unread message first
      cmp = -byDateAsc(a.latestUnreadAt, b.latestUnreadAt);
      break;
    case 3: // newest report first
      cmp = -byDateAsc(
        a.latestReport?.published_at ?? null,
        b.latestReport?.published_at ?? null,
      );
      break;
    case 4: // soonest upcoming payment first
      cmp = byDateAsc(a.sponsorship.next_payment_date, b.sponsorship.next_payment_date);
      break;
    case 5: // most recently started first
      cmp = -byDateAsc(a.sponsorship.start_date, b.sponsorship.start_date);
      break;
  }
  if (cmp !== 0) return cmp;

  const nameA = a.sponsorship.orphan_name ?? "";
  const nameB = b.sponsorship.orphan_name ?? "";
  return nameA.localeCompare(nameB) || a.sponsorship.id.localeCompare(b.sponsorship.id);
}

/** Stable hash of an orphan_id onto a fixed avatar-palette index — the
 * same child always gets the same color, and never a random one. */
export function avatarPaletteIndex(orphanId: string, paletteSize: number): number {
  let hash = 0;
  for (let i = 0; i < orphanId.length; i++) {
    hash = (hash * 31 + orphanId.charCodeAt(i)) >>> 0;
  }
  return paletteSize > 0 ? hash % paletteSize : 0;
}

// ── Toolbar: filter chips + search + sort ────────────────────────────

export type FilterChip = "all" | "attention" | "active" | "paused";

export type SortKey = "priority" | "name" | "newest";

/** Overdue or carrying an unread message — the "تحتاج انتباهك" chip. */
export function needsAttention(card: OrphanCardData): boolean {
  return card.sponsorship.status === "overdue" || card.unreadCount > 0;
}

export function filterCards(
  cards: OrphanCardData[],
  chip: FilterChip,
  query: string,
): OrphanCardData[] {
  const q = query.trim().toLowerCase();
  return cards.filter((card) => {
    const s = card.sponsorship;
    if (chip === "attention" && !needsAttention(card)) return false;
    if (chip === "active" && s.status !== "active") return false;
    if (chip === "paused" && s.status !== "paused") return false;
    if (!q) return true;
    const name = (s.orphan_name ?? "").toLowerCase();
    const code = (s.orphan_code ?? "").toLowerCase();
    return name.includes(q) || code.includes(q);
  });
}

export function sortCards(
  cards: OrphanCardData[],
  sort: SortKey,
  now: Date,
): OrphanCardData[] {
  const out = [...cards];
  switch (sort) {
    case "name":
      out.sort(
        (a, b) =>
          (a.sponsorship.orphan_name ?? "").localeCompare(
            b.sponsorship.orphan_name ?? "",
          ) || a.sponsorship.id.localeCompare(b.sponsorship.id),
      );
      break;
    case "newest":
      out.sort(
        (a, b) =>
          -byDateAsc(a.sponsorship.start_date, b.sponsorship.start_date) ||
          a.sponsorship.id.localeCompare(b.sponsorship.id),
      );
      break;
    default:
      out.sort((a, b) => compareOrphanCards(a, b, now));
  }
  return out;
}

// ── Impact bar ───────────────────────────────────────────────────────

/** Per-currency money aggregate. Amounts in different currencies are
 * NEVER summed together — each currency keeps its own bucket. */
export interface CurrencyBucket {
  currency: string;
  totalPaid: number;
  monthlyActive: number;
  sponsorships: number;
}

export interface ImpactSummary {
  childrenCount: number;
  /** Earliest live start_date, for the "caring since" opener. */
  earliestStart: string | null;
  /** The currency with the most live sponsorships (ties → larger total). */
  dominant: CurrencyBucket;
  /** How many OTHER currencies exist beyond the dominant one. */
  otherCurrenciesCount: number;
  paymentsCount: number;
  /** Soonest FUTURE next_payment_date among active sponsorships. */
  nextPayment: { date: string; orphanName: string | null } | null;
}

/** Client-side aggregation over the live sponsorships. Returns null when
 * there is nothing live to summarize. */
export function summarizeImpact(
  sponsorships: Sponsorship[],
  now: Date,
): ImpactSummary | null {
  const live = sponsorships.filter((s) => LIVE_STATUSES.has(s.status));
  if (live.length === 0) return null;

  const buckets = new Map<string, CurrencyBucket>();
  let earliestStart: string | null = null;
  let paymentsCount = 0;
  let nextPayment: { date: string; orphanName: string | null } | null = null;

  for (const s of live) {
    const bucket = buckets.get(s.currency) ?? {
      currency: s.currency,
      totalPaid: 0,
      monthlyActive: 0,
      sponsorships: 0,
    };
    bucket.sponsorships += 1;
    const paid = Number(s.total_paid);
    if (Number.isFinite(paid)) bucket.totalPaid += paid;
    if (s.status === "active") {
      const monthly = Number(s.monthly_amount);
      if (Number.isFinite(monthly)) bucket.monthlyActive += monthly;
    }
    buckets.set(s.currency, bucket);

    paymentsCount += s.payments_count;

    if (!Number.isNaN(time(s.start_date))) {
      if (earliestStart === null || time(s.start_date) < time(earliestStart)) {
        earliestStart = s.start_date;
      }
    }

    if (s.status === "active" && s.next_payment_date) {
      const t = time(s.next_payment_date);
      if (!Number.isNaN(t) && t >= now.getTime()) {
        if (!nextPayment || t < time(nextPayment.date)) {
          nextPayment = { date: s.next_payment_date, orphanName: s.orphan_name };
        }
      }
    }
  }

  const ranked = [...buckets.values()].sort(
    (a, b) =>
      b.sponsorships - a.sponsorships ||
      b.totalPaid - a.totalPaid ||
      a.currency.localeCompare(b.currency),
  );

  const dominant = ranked[0];
  if (!dominant) return null;

  const distinctChildren = new Set(live.map((s) => s.orphan_id)).size;

  return {
    childrenCount: distinctChildren,
    earliestStart,
    dominant,
    otherCurrenciesCount: ranked.length - 1,
    paymentsCount,
    nextPayment,
  };
}
