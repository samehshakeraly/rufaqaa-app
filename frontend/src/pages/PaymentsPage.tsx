import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Money } from "@/components/Money";
import { TableSkeleton } from "@/components/Skeleton";
import { fetchOrganization } from "@/lib/organization";
import { exportPaymentsCsv, listPayments, PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";
import { fetchSummary } from "@/lib/stats";
import { toast } from "@/store/toasts";

import "./finance.css";
import "./PaymentsPage.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

const PAGE_SIZES = [25, 50, 100] as const;

// Tabs map to the server-side status filter. "" = all. (Mockup omits a
// standalone "pending" tab; pending counts still surface in the stat strip.)
const TABS = ["", "completed", "processing", "failed", "refunded"] as const;

// Quick date ranges → the server-side `date_from` lower bound (the selected
// range's start). "all" sends no bound.
const RANGES = ["all", "today", "month", "90d", "year"] as const;
type Range = (typeof RANGES)[number];

function rangeStart(range: Range): number | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (range === "90d") return now.getTime() - 90 * 86_400_000;
  return new Date(now.getFullYear(), 0, 1).getTime(); // year
}

// Status → chip tone. Unknown statuses fall back to a neutral pending look.
const STATUS_TONE: Record<string, string> = {
  completed: "success",
  pending: "pending",
  processing: "processing",
  failed: "failed",
  refunded: "refunded",
};

export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "">("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset to first page whenever the tab, page size, or any server filter changes.
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, pageSize, range, methodFilter, currencyFilter]);

  // Selected quick-range → a stable `date_from` (memoised on `range` so a
  // relative range like "90d" doesn't drift every render and churn the query).
  const dateFrom = useMemo(() => {
    const start = rangeStart(range);
    return start != null ? new Date(start).toISOString() : undefined;
  }, [range]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "payments",
      { limit: pageSize, offset, statusFilter, dateFrom, methodFilter, currencyFilter },
    ],
    queryFn: () =>
      listPayments({
        limit: pageSize,
        offset,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(methodFilter ? { method: methodFilter } : {}),
        ...(currencyFilter ? { currency: currencyFilter } : {}),
      }),
  });
  const { data: org } = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });
  const { data: summary } = useQuery({ queryKey: ["stats", "summary"], queryFn: fetchSummary });
  // Lightweight count-only probes for the stat strip (limit 1 → reads `total`).
  const { data: pending } = useQuery({
    queryKey: ["payments", { status: "pending", count: true }],
    queryFn: () => listPayments({ status: "pending", limit: 1 }),
  });
  const { data: refunded } = useQuery({
    queryKey: ["payments", { status: "refunded", count: true }],
    queryFn: () => listPayments({ status: "refunded", limit: 1 }),
  });
  // Currency dropdown options come from a status-scoped probe (NOT narrowed by
  // the method/currency/date filters), so the list stays stable once a currency
  // is picked. Methods use the full static list (PAYMENT_METHODS) instead.
  const { data: currencyProbe } = useQuery({
    queryKey: ["payments", { currencyOptions: true, statusFilter }],
    queryFn: () =>
      listPayments({ ...(statusFilter ? { status: statusFilter } : {}), limit: 100 }),
  });

  const baseCurrency = org?.default_currency ?? null;
  const lang = i18n.language;

  // Date range, method and currency are now filtered server-side. Only the
  // free-text search still narrows the loaded page client-side (/payments has
  // no search param).
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.code.toLowerCase().includes(q) || (p.payment_gateway ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

  const currencyOptions = useMemo(
    () => Array.from(new Set((currencyProbe?.items ?? []).map((p) => p.currency))).sort(),
    [currencyProbe],
  );

  const selectedRows = rows.filter((p) => selected.has(p.id));
  const selCurrency =
    selectedRows.length > 0 && selectedRows.every((p) => p.currency === selectedRows[0]!.currency)
      ? selectedRows[0]!.currency
      : null;
  const selTotal = selCurrency ? selectedRows.reduce((s, p) => s + Number(p.amount), 0) : null;

  function toggleRow(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allOnPageSelected = rows.length > 0 && rows.every((p) => selected.has(p.id));
  function toggleAll() {
    setSelected((cur) => {
      if (rows.every((p) => cur.has(p.id))) {
        const next = new Set(cur);
        rows.forEach((p) => next.delete(p.id));
        return next;
      }
      return new Set([...cur, ...rows.map((p) => p.id)]);
    });
  }

  async function onExport() {
    try {
      const blob = await exportPaymentsCsv(statusFilter ? { status: statusFilter } : {});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rufaqaa-payments.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("common.loadError"));
    }
  }

  const showingTo = Math.min(offset + pageSize, data?.total ?? 0);

  return (
    <div className="fin-page">
      <div className="fin-head">
        <div>
          <h1>{t("payments.title")}</h1>
          <p>{t("payments.subtitle")}</p>
        </div>
        <div className="fin-head-actions">
          <button type="button" className="fin-btn-secondary" onClick={onExport}>
            <FinIcon>{FIN_ICONS.download}</FinIcon>
            {t("payments.exportCsv")}
          </button>
          <Link to="/admin/payments/walk-in" className="fin-btn-primary">
            <FinIcon>{FIN_ICONS.plus}</FinIcon>
            {t("payments.addManual")}
          </Link>
        </div>
      </div>

      {/* ── Stat strip ─────────────────────────────────────────────── */}
      <section className="fin-stat-strip" aria-label={t("payments.title")}>
        <Stat
          icon={FIN_ICONS.dollar}
          label={t("payments.statRevenue")}
          value={
            summary ? (
              <Money amount={summary.payments_last_30d_total} currency={baseCurrency} />
            ) : (
              <span className="fin-ph">—</span>
            )
          }
        />
        <Stat
          icon={FIN_ICONS.checkSquare}
          label={t("payments.statCount")}
          value={
            summary ? (
              summary.payments_last_30d_count.toLocaleString(lang)
            ) : (
              <span className="fin-ph">—</span>
            )
          }
        />
        <Stat
          tone="warn"
          icon={FIN_ICONS.clock}
          label={t("payments.statPending")}
          value={pending ? pending.total.toLocaleString(lang) : <span className="fin-ph">—</span>}
        />
        <Stat
          tone="purple"
          icon={FIN_ICONS.exchange}
          label={t("payments.statRefunded")}
          value={refunded ? refunded.total.toLocaleString(lang) : <span className="fin-ph">—</span>}
        />
        <Stat
          icon={FIN_ICONS.receipt}
          label={t("common.total")}
          value={data ? data.total.toLocaleString(lang) : <span className="fin-ph">—</span>}
        />
      </section>

      {/* ── Tabs (status filter) ───────────────────────────────────── */}
      <nav className="fin-tabs" aria-label={t("payments.status")}>
        {TABS.map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`fin-tab${statusFilter === s ? " active" : ""}`}
            aria-pressed={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          >
            {s === "" ? t("payments.tabAll") : t(`payments.statuses.${s}`, s)}
          </button>
        ))}
      </nav>

      {/* ── Search + filters (date/method/currency are server-side) ──── */}
      <section className="fin-filter-bar">
        <div className="fin-search">
          <FinIcon>{FIN_ICONS.search}</FinIcon>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("payments.searchPlaceholder")}
            aria-label={t("payments.searchPlaceholder")}
          />
        </div>
        <div className="fin-range-strip" role="group" aria-label={t("payments.range")}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={`fin-range-btn${range === r ? " active" : ""}`}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {t(`payments.ranges.${r}`)}
            </button>
          ))}
        </div>
        <label className="fin-fpill">
          <span className="sr-only">{t("payments.method")}</span>
          <FinIcon>{FIN_ICONS.exchange}</FinIcon>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as PaymentMethod | "")}
            aria-label={t("payments.method")}
          >
            <option value="">{t("payments.allMethods")}</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`payments.methods.${m}`, m)}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-fpill">
          <span className="sr-only">{t("payments.currency")}</span>
          <FinIcon>{FIN_ICONS.dollar}</FinIcon>
          <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)} aria-label={t("payments.currency")}>
            <option value="">{t("payments.allCurrencies")}</option>
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* ── Bulk selection bar ─────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fin-bulkbar">
          <div className="fin-bulkbar-info">
            <span className="count-pill fin-latin">{selected.size.toLocaleString(lang)}</span>
            {t("payments.selected")}
            {selTotal != null && selCurrency && (
              <>
                {" · "}
                <Money amount={String(selTotal)} currency={selCurrency} />
              </>
            )}
          </div>
          <div className="fin-bulkbar-actions">
            {/* TODO(backend): no bulk reconcile / send-receipt endpoint yet. */}
            <button type="button" className="bulk-btn" onClick={() => toast.info(t("common.comingSoon"))}>
              <FinIcon>{FIN_ICONS.check}</FinIcon>
              {t("payments.bulkReconcile")}
            </button>
            <button type="button" className="bulk-btn" onClick={() => toast.info(t("common.comingSoon"))}>
              <FinIcon>{FIN_ICONS.receipt}</FinIcon>
              {t("payments.bulkReceipts")}
            </button>
            <button type="button" className="bulk-btn" onClick={() => setSelected(new Set())}>
              <FinIcon>{FIN_ICONS.x}</FinIcon>
              {t("payments.clearSelection")}
            </button>
          </div>
        </div>
      )}

      {isLoading && <TableSkeleton columns={6} />}
      {error && <p className="fin-error">{t("common.loadError")}</p>}

      {data && rows.length === 0 && (
        <div className="fin-tbl-card">
          <div className="fin-empty">
            <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
            <div className="fin-empty-title">
              {query ? t("payments.noResults") : t("common.empty")}
            </div>
          </div>
        </div>
      )}

      {data && rows.length > 0 && (
        <section className="fin-tbl-card">
          <div className="fin-tbl-scroll">
            <table className="fin-table fin-pay-table">
              <caption className="sr-only">{t("payments.title")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="fin-chk-col">
                    <label className="fin-check-wrap">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        aria-label={t("payments.selectAll")}
                      />
                    </label>
                  </th>
                  <th scope="col">{t("payments.code")}</th>
                  <th scope="col">{t("payments.donor")}</th>
                  <th scope="col">{t("payments.method")}</th>
                  <th scope="col" className="num-h">
                    {t("payments.amount")}
                  </th>
                  <th scope="col">{t("payments.orphan")}</th>
                  <th scope="col">{t("payments.type")}</th>
                  <th scope="col">{t("payments.status")}</th>
                  <th scope="col" aria-label={t("payments.viewReceipt")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={selected.has(p.id) ? "selected" : undefined}>
                    <td className="fin-chk-col">
                      <label className="fin-check-wrap">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggleRow(p.id)}
                          aria-label={t("payments.selectRow", { code: p.code })}
                        />
                      </label>
                    </td>
                    <td>
                      <div className="fin-cell-id">{p.code}</div>
                      <div className="fin-cell-sub fin-latin">
                        {p.completed_at ? p.completed_at.slice(0, 10) : <span className="fin-ph">—</span>}
                      </div>
                    </td>
                    {/* Privacy: a non-identifying donor reference (code) only —
                        never the donor's name or email. */}
                    <td>
                      {p.donor_reference ? (
                        <span className="fin-cell-id">{p.donor_reference}</span>
                      ) : (
                        <span className="fin-ph">—</span>
                      )}
                    </td>
                    <td>
                      <span className="fin-method">
                        {t(`payments.methods.${p.payment_method}`, p.payment_method)}
                      </span>
                      {p.payment_gateway && (
                        <div className="fin-cell-sub">{p.payment_gateway}</div>
                      )}
                    </td>
                    <td className="fin-amt">
                      <Money amount={p.amount} currency={p.currency} />
                    </td>
                    {/* Child safety: orphan column shows the code only, never a name. */}
                    <td>
                      {p.orphan_code ? (
                        <span className="fin-cell-id">{p.orphan_code}</span>
                      ) : (
                        <span className="fin-ph">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`fin-type ${p.payment_type}`}>
                        {t(`payments.types.${p.payment_type}`)}
                      </span>
                    </td>
                    <td>
                      <span className={`fin-status ${STATUS_TONE[p.status] ?? "pending"}`}>
                        {t(`payments.statuses.${p.status}`, p.status)}
                      </span>
                    </td>
                    <td style={{ textAlign: "end" }}>
                      <Link to={`/admin/payments/${p.id}/receipt`} className="fin-link">
                        {t("payments.viewReceipt")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fin-tbl-foot">
            <span>
              {t("payments.showing", {
                from: data.total === 0 ? 0 : offset + 1,
                to: showingTo,
                total: data.total,
              })}
            </span>
            <div className="fin-pager">
              <label className="fin-pagesize">
                <span>{t("payments.perPage")}</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label={t("payments.perPage")}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <NumberedPager
                total={data.total}
                pageSize={pageSize}
                offset={offset}
                onOffset={setOffset}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// Numbered pager with a sliding window + first/last and ellipses. Reads
// oldest→newest in document order; RTL flips it visually via CSS.
function NumberedPager({
  total,
  pageSize,
  offset,
  onOffset,
}: {
  total: number;
  pageSize: number;
  offset: number;
  onOffset: (next: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.floor(offset / pageSize) + 1;
  if (pages <= 1) return null;

  const nums = new Set<number>([1, pages, current, current - 1, current + 1]);
  const sorted = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }

  return (
    <nav className="fin-pages" aria-label={t("pagination.prev")}>
      <button
        type="button"
        className="fin-page-btn"
        disabled={current === 1}
        onClick={() => onOffset(Math.max(0, offset - pageSize))}
      >
        {t("pagination.prev")}
      </button>
      {out.map((n, i) =>
        n === "…" ? (
          <span key={`gap-${i}`} className="fin-page-gap">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            className={`fin-page-btn fin-latin${n === current ? " active" : ""}`}
            aria-current={n === current ? "page" : undefined}
            onClick={() => onOffset((n - 1) * pageSize)}
          >
            {n}
          </button>
        ),
      )}
      <button
        type="button"
        className="fin-page-btn"
        disabled={current === pages}
        onClick={() => onOffset(offset + pageSize)}
      >
        {t("pagination.next")}
      </button>
    </nav>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "purple" | "danger" | "gold";
}) {
  return (
    <div className="fin-stat">
      <div className={`fin-stat-icon${tone ? ` ${tone}` : ""}`}>
        <FinIcon>{icon}</FinIcon>
      </div>
      <div className="fin-stat-text">
        <div className="lbl">{label}</div>
        <div className="val">{value}</div>
      </div>
    </div>
  );
}
