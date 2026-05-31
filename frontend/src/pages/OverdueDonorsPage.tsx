import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { TableSkeleton } from "@/components/Skeleton";
import { listPayments } from "@/lib/payments";
import { listSponsorships, type Sponsorship } from "@/lib/sponsorships";
import { toast } from "@/store/toasts";

import "./finance.css";
import "./OverdueDonorsPage.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

// Phone glyph (not in the shared finance set) for the critical-band "call".
const PHONE_ICON = (
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
);

type ActionTone = "primary" | "warn" | "danger";
interface BandAction {
  key: string; // i18n key under finance.overdue.act*
  tone: ActionTone;
  icon: typeof FIN_ICONS.mail;
}
// Context-aware row actions per severity band (F-03). Kindness escalates with
// lateness. Handlers are stubbed (comingSoon) — no reminder/suspend endpoint.
const BAND_ACTIONS: Record<"b1" | "b2" | "b3" | "b4", BandAction[]> = {
  b1: [{ key: "actRemindFriendly", tone: "primary", icon: FIN_ICONS.mail }],
  b2: [
    { key: "actRemindWhatsapp", tone: "primary", icon: FIN_ICONS.send },
    { key: "actSuggestPostpone", tone: "warn", icon: FIN_ICONS.calendar },
  ],
  b3: [
    { key: "actRemindWhatsapp", tone: "primary", icon: FIN_ICONS.send },
    { key: "actSuggestPostpone", tone: "warn", icon: FIN_ICONS.calendar },
  ],
  b4: [
    { key: "actSuspend", tone: "danger", icon: FIN_ICONS.slash },
    { key: "actCall", tone: "warn", icon: PHONE_ICON },
  ],
};

type SortKey = "daysDesc" | "daysAsc" | "amountDesc";
const SORTS: SortKey[] = ["daysDesc", "daysAsc", "amountDesc"];

// Severity bands keyed by days overdue. A sponsorship reaches this screen
// only when the server-side `is_overdue` filter already flagged it, so the
// minimum band is "light".
type BandKey = "b1" | "b2" | "b3" | "b4";
const BAND_ORDER: BandKey[] = ["b1", "b2", "b3", "b4"];

function daysOverdue(nextPaymentDate: string | null): number | null {
  if (!nextPaymentDate) return null;
  const due = new Date(nextPaymentDate);
  if (Number.isNaN(due.getTime())) return null;
  const diff = Math.floor((Date.now() - due.getTime()) / 86_400_000);
  return Math.max(1, diff);
}

function bandFor(days: number | null): BandKey {
  if (days == null) return "b1";
  if (days > 90) return "b4";
  if (days > 60) return "b3";
  if (days > 30) return "b2";
  return "b1";
}

export function OverdueDonorsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [activeBand, setActiveBand] = useState<BandKey | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("daysDesc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["sponsorships", { overdue: true }],
    queryFn: () => listSponsorships({ is_overdue: true, min_months_overdue: 1, limit: 200 }),
  });
  const { data: lastPayments } = useQuery({
    queryKey: ["payments", { donorOverdue: true, limit: 200 }],
    queryFn: () => listPayments({ donor_overdue: true, limit: 200 }),
  });

  const lastPaymentByDonor = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of lastPayments?.items ?? []) {
      if (!m.has(p.donor_id)) m.set(p.donor_id, p.completed_at);
    }
    return m;
  }, [lastPayments]);

  const items = useMemo(() => data?.items ?? [], [data]);

  // Per-band aggregates (count + summed monthly amount) computed from the
  // real list — no invented numbers.
  const bands = useMemo(() => {
    const acc: Record<BandKey, { count: number; total: number; currency: string | null }> = {
      b1: { count: 0, total: 0, currency: null },
      b2: { count: 0, total: 0, currency: null },
      b3: { count: 0, total: 0, currency: null },
      b4: { count: 0, total: 0, currency: null },
    };
    for (const s of items) {
      const b = bandFor(daysOverdue(s.next_payment_date));
      acc[b].count += 1;
      acc[b].total += Number(s.monthly_amount) || 0;
      acc[b].currency ??= s.currency;
    }
    return acc;
  }, [items]);

  // TODO(backend): server-side filtering/sorting — search, band filter and
  // sort all run client-side over the loaded list.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((s) => {
      if (activeBand && bandFor(daysOverdue(s.next_payment_date)) !== activeBand) return false;
      if (!q) return true;
      return (
        (s.donor_name ?? "").toLowerCase().includes(q) ||
        (s.donor_code ?? "").toLowerCase().includes(q)
      );
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "amountDesc") return (Number(b.monthly_amount) || 0) - (Number(a.monthly_amount) || 0);
      const da = daysOverdue(a.next_payment_date) ?? 0;
      const db = daysOverdue(b.next_payment_date) ?? 0;
      return sortKey === "daysAsc" ? da - db : db - da;
    });
    return sorted;
  }, [items, activeBand, query, sortKey]);

  function toggleRow(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  function toggleAll() {
    setSelected((cur) => {
      if (filtered.every((s) => cur.has(s.id))) {
        const next = new Set(cur);
        filtered.forEach((s) => next.delete(s.id));
        return next;
      }
      return new Set([...cur, ...filtered.map((s) => s.id)]);
    });
  }

  const totalOverdue = items.reduce((sum, s) => sum + (Number(s.monthly_amount) || 0), 0);
  const totalCurrency = items[0]?.currency ?? null;

  return (
    <div className="fin-page">
      <div className="fin-head">
        <div>
          <h1>{t("finance.overdue.title")}</h1>
          <p>{t("finance.overdue.subtitle")}</p>
        </div>
        <div className="fin-head-actions">
          <button
            type="button"
            className="fin-btn-primary"
            onClick={() => toast.info(t("common.comingSoon"))}
          >
            <FinIcon>{FIN_ICONS.mail}</FinIcon>
            {t("finance.overdue.bulkReminder")}
          </button>
        </div>
      </div>

      {/* Tone reminder — kindness before pressure */}
      <div className="fin-tone-banner">
        <div className="ic">
          <FinIcon className="fin-icon">{FIN_ICONS.heart}</FinIcon>
        </div>
        <div>
          {t("finance.overdue.toneBanner")}{" "}
          <strong>{t("finance.overdue.toneBannerStrong")}</strong>
        </div>
      </div>

      {/* Severity bands (computed from real data; click to filter) */}
      <section className="fin-bands" aria-label={t("finance.overdue.monthsOverdue")}>
        {BAND_ORDER.map((b) => (
          <button
            key={b}
            type="button"
            className={`fin-band ${b}${activeBand === b ? " active" : ""}`}
            aria-pressed={activeBand === b}
            onClick={() => setActiveBand((cur) => (cur === b ? null : b))}
          >
            <div className="fin-band-head">
              <div className="fin-band-icon">
                <FinIcon className="fin-icon">
                  {b === "b4" ? FIN_ICONS.alert : FIN_ICONS.clock}
                </FinIcon>
              </div>
              <div>
                <div className="lab">{t(`finance.overdue.band${BAND_LABEL[b]}`)}</div>
                <div className="sub">{t(`finance.overdue.band${BAND_LABEL[b]}Range`)}</div>
              </div>
            </div>
            <div className="count">
              <span>{bands[b].count.toLocaleString(lang)}</span>
              <span className="small">{t("finance.overdue.donor")}</span>
            </div>
            <div className="amt">
              <Money amount={bands[b].total} currency={bands[b].currency} />
            </div>
            <div className="fin-band-advice">{t(`finance.overdue.band${BAND_LABEL[b]}Advice`)}</div>
          </button>
        ))}
      </section>

      {/* Search + filters */}
      <section className="fin-filter-bar">
        <div className="fin-search">
          <FinIcon>{FIN_ICONS.search}</FinIcon>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("finance.overdue.searchPlaceholder")}
            aria-label={t("finance.overdue.searchPlaceholder")}
          />
        </div>
        <label className="fin-fpill">
          <span className="sr-only">{t("finance.overdue.sortBy")}</span>
          <FinIcon>{FIN_ICONS.bars}</FinIcon>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label={t("finance.overdue.sortBy")}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`finance.overdue.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {/* TODO(backend): donor country is not on the sponsorship payload — the
            country filter renders the layout but stays disabled until exposed. */}
        <label className="fin-fpill" aria-disabled="true">
          <span className="sr-only">{t("finance.overdue.country")}</span>
          <FinIcon>{FIN_ICONS.users}</FinIcon>
          <select disabled aria-label={t("finance.overdue.country")}>
            <option>{t("finance.overdue.allCountries")}</option>
          </select>
        </label>
      </section>

      {/* Bulk selection bar */}
      {selected.size > 0 && (
        <div className="fin-bulkbar">
          <div className="fin-bulkbar-info">
            <span className="count-pill fin-latin">{selected.size.toLocaleString(lang)}</span>
            {t("finance.overdue.selected")}
          </div>
          {/* TODO(backend): no reminder / hide endpoint yet. */}
          <div className="fin-bulkbar-actions">
            <button type="button" className="bulk-btn" onClick={() => toast.info(t("common.comingSoon"))}>
              <FinIcon>{FIN_ICONS.send}</FinIcon>
              {t("finance.overdue.bulkWhatsapp")}
            </button>
            <button type="button" className="bulk-btn" onClick={() => toast.info(t("common.comingSoon"))}>
              <FinIcon>{FIN_ICONS.mail}</FinIcon>
              {t("finance.overdue.bulkEmail")}
            </button>
            <button type="button" className="bulk-btn" onClick={() => setSelected(new Set())}>
              <FinIcon>{FIN_ICONS.x}</FinIcon>
              {t("finance.overdue.clearSelection")}
            </button>
          </div>
        </div>
      )}

      {isLoading && <TableSkeleton columns={6} />}
      {error && <p className="fin-error">{t("common.loadError")}</p>}

      {data && filtered.length === 0 && (
        <div className="fin-tbl-card">
          <div className="fin-empty">
            <FinIcon className="fin-icon">{FIN_ICONS.heart}</FinIcon>
            <div className="fin-empty-title">{t("finance.overdue.empty")}</div>
          </div>
        </div>
      )}

      {data && filtered.length > 0 && (
        <section className="fin-tbl-card">
          <div className="fin-tbl-scroll">
            <table className="fin-table">
              <caption className="sr-only">{t("finance.overdue.title")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="fin-chk-col">
                    <label className="fin-check-wrap">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label={t("finance.overdue.selectAll")}
                      />
                    </label>
                  </th>
                  <th scope="col">{t("finance.overdue.donor")}</th>
                  <th scope="col">{t("finance.overdue.monthsOverdue")}</th>
                  <th scope="col" className="num-h">
                    {t("finance.overdue.monthlyAmount")}
                  </th>
                  <th scope="col">{t("finance.overdue.orphan")}</th>
                  <th scope="col">{t("finance.overdue.reminderTrail")}</th>
                  <th scope="col">{t("finance.overdue.lastPayment")}</th>
                  <th scope="col" aria-label={t("finance.overdue.actions")} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <OverdueRow
                    key={s.id}
                    s={s}
                    lastPayment={lastPaymentByDonor.get(s.donor_id)}
                    selected={selected.has(s.id)}
                    onToggle={() => toggleRow(s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="fin-tbl-foot">
            <span>
              {t("finance.overdue.totalOverdue", { count: items.length })} ·{" "}
              <Money amount={totalOverdue} currency={totalCurrency} />
            </span>
            <span className="fin-card-note">{t("finance.overdue.reminderNotTracked")}</span>
          </div>
        </section>
      )}
    </div>
  );
}

const BAND_LABEL: Record<BandKey, string> = {
  b1: "Light",
  b2: "Medium",
  b3: "Long",
  b4: "Critical",
};

function OverdueRow({
  s,
  lastPayment,
  selected,
  onToggle,
}: {
  s: Sponsorship;
  lastPayment: string | null | undefined;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const days = daysOverdue(s.next_payment_date);
  const band = bandFor(days);
  const initials = (s.donor_name ?? "—").slice(0, 2);

  return (
    <tr className={`${band}${selected ? " selected" : ""}`}>
      <td className="fin-chk-col">
        <label className="fin-check-wrap">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={t("finance.overdue.selectRow", { name: s.donor_code ?? "—" })}
          />
        </label>
      </td>
      <td>
        <div className="fin-donor">
          <span className="fin-avatar">{initials}</span>
          <div className="info">
            <div className="nm">{s.donor_name ?? "—"}</div>
            <div className="meta">{s.donor_code ?? "—"}</div>
          </div>
        </div>
      </td>
      <td>
        {days == null ? (
          <span className="fin-ph">—</span>
        ) : (
          <span className={`fin-late-badge ${band}`}>{t("finance.overdue.daysBadge", { n: days })}</span>
        )}
      </td>
      <td className="fin-amt">
        <Money amount={s.monthly_amount} currency={s.currency} />
      </td>
      <td>
        <span style={{ fontSize: 12, color: "var(--gray-700)" }}>
          {s.orphan_code ? <span className="fin-orph-pill">{s.orphan_code}</span> : <span className="fin-ph">—</span>}
        </span>
      </td>
      <td>
        {/* TODO(backend): reminder history isn't exposed by the API — the trail
            renders the design layout with placeholder (not-yet-sent) steps. */}
        <div className="fin-trail" role="img" aria-label={t("finance.overdue.reminderNotTracked")}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="fin-trail-step">
              {i > 0 && <span className="fin-trail-line" />}
              <span className="fin-trail-dot" />
            </span>
          ))}
        </div>
      </td>
      <td className="fin-cell-num">
        {lastPayment ? lastPayment.slice(0, 10) : <span className="fin-ph">—</span>}
      </td>
      <td>
        {/* TODO(backend): reminder/postpone/suspend have no endpoint — stubbed. */}
        <div className="fin-row-actions">
          {BAND_ACTIONS[band].map((a) => (
            <button
              key={a.key}
              type="button"
              className={`fin-action-sm ${a.tone}`}
              onClick={() => toast.info(t("common.comingSoon"))}
            >
              <FinIcon>{a.icon}</FinIcon>
              {t(`finance.overdue.${a.key}`)}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
