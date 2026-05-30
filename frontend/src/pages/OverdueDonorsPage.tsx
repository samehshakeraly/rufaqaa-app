import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { TableSkeleton } from "@/components/Skeleton";
import { listPayments } from "@/lib/payments";
import { listSponsorships, type Sponsorship } from "@/lib/sponsorships";
import { toast } from "@/store/toasts";

import "./finance.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((s) => {
      if (activeBand && bandFor(daysOverdue(s.next_payment_date)) !== activeBand) return false;
      if (!q) return true;
      return (
        (s.donor_name ?? "").toLowerCase().includes(q) ||
        (s.donor_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, activeBand, query]);

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
          </button>
        ))}
      </section>

      {/* Search */}
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
      </section>

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
                  <th scope="col">{t("finance.overdue.donor")}</th>
                  <th scope="col">{t("finance.overdue.monthsOverdue")}</th>
                  <th scope="col" className="num-h">
                    {t("finance.overdue.monthlyAmount")}
                  </th>
                  <th scope="col">{t("finance.overdue.orphan")}</th>
                  <th scope="col">{t("finance.overdue.reminderTrail")}</th>
                  <th scope="col">{t("finance.overdue.lastPayment")}</th>
                  <th scope="col" aria-label={t("finance.overdue.sendReminder")} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <OverdueRow
                    key={s.id}
                    s={s}
                    lastPayment={lastPaymentByDonor.get(s.donor_id)}
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
}: {
  s: Sponsorship;
  lastPayment: string | null | undefined;
}) {
  const { t } = useTranslation();
  const days = daysOverdue(s.next_payment_date);
  const band = bandFor(days);
  const initials = (s.donor_name ?? "—").slice(0, 2);

  return (
    <tr className={band}>
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
        {/* TODO(backend): reminder history isn't exposed by the API. */}
        <span className="fin-ph">—</span>
      </td>
      <td className="fin-cell-num">
        {lastPayment ? lastPayment.slice(0, 10) : <span className="fin-ph">—</span>}
      </td>
      <td>
        <div className="fin-row-actions">
          <button
            type="button"
            className="fin-action-sm primary"
            onClick={() => toast.info(t("common.comingSoon"))}
          >
            <FinIcon>{FIN_ICONS.mail}</FinIcon>
            {t("finance.overdue.sendReminder")}
          </button>
        </div>
      </td>
    </tr>
  );
}
