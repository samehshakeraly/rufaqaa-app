import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Money } from "@/components/Money";
import { TableSkeleton } from "@/components/Skeleton";
import { fetchOrganization } from "@/lib/organization";
import { exportPaymentsCsv, listPayments } from "@/lib/payments";
import { fetchSummary } from "@/lib/stats";
import { toast } from "@/store/toasts";

import "./finance.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

const PAGE_SIZE = 20;

// Tabs map to the server-side status filter. "" = all.
const TABS = ["", "completed", "pending", "processing", "failed", "refunded"] as const;

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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [query, setQuery] = useState("");

  // Reset to first page whenever the tab changes.
  useEffect(() => {
    setOffset(0);
  }, [statusFilter]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", { limit: PAGE_SIZE, offset, statusFilter }],
    queryFn: () =>
      listPayments({
        limit: PAGE_SIZE,
        offset,
        ...(statusFilter ? { status: statusFilter } : {}),
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

  const baseCurrency = org?.default_currency ?? null;
  const lang = i18n.language;

  // Client-side search over the current page (code / gateway). The server
  // has no free-text payment search, so this narrows the loaded page only.
  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        (p.payment_gateway ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

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

  const showingTo = Math.min(offset + PAGE_SIZE, data?.total ?? 0);

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

      {/* ── Search ─────────────────────────────────────────────────── */}
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
      </section>

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
            <table className="fin-table">
              <caption className="sr-only">{t("payments.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("payments.code")}</th>
                  <th scope="col" className="num-h">
                    {t("payments.amount")}
                  </th>
                  <th scope="col">{t("payments.method")}</th>
                  <th scope="col">{t("payments.gateway")}</th>
                  <th scope="col">{t("payments.status")}</th>
                  <th scope="col">{t("payments.completedAt")}</th>
                  <th scope="col" aria-label={t("payments.viewReceipt")} />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="fin-cell-id">{p.code}</td>
                    <td className="fin-amt">
                      <Money amount={p.amount} currency={p.currency} />
                    </td>
                    <td>
                      <span className="fin-method">
                        {t(`payments.methods.${p.payment_method}`, p.payment_method)}
                      </span>
                    </td>
                    <td>{p.payment_gateway ?? <span className="fin-ph">—</span>}</td>
                    <td>
                      <span className={`fin-status ${STATUS_TONE[p.status] ?? "pending"}`}>
                        {t(`payments.statuses.${p.status}`, p.status)}
                      </span>
                    </td>
                    <td className="fin-cell-num">
                      {p.completed_at ? p.completed_at.slice(0, 10) : <span className="fin-ph">—</span>}
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
            <div className="fin-head-actions">
              <button
                type="button"
                className="fin-btn-secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t("pagination.prev")}
              </button>
              <button
                type="button"
                className="fin-btn-secondary"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t("pagination.next")}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
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
