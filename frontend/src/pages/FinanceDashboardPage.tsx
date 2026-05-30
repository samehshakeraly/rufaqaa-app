import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Money } from "@/components/Money";
import { Skeleton, StatGridSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { listBankTransfers } from "@/lib/bankTransfers";
import { fetchOrganization } from "@/lib/organization";
import { listPayments } from "@/lib/payments";
import { fetchDonationsByPartner, fetchPaymentsTimeseries, fetchSummary } from "@/lib/stats";

import "./finance.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

const DASH = "—";

function useFmt() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    int: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
    money: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
    compact: (n: number) => n.toLocaleString(lang, { notation: "compact", maximumFractionDigits: 1 }),
    monthShort: (d: Date) => new Intl.DateTimeFormat(lang, { month: "short" }).format(d),
  };
}

export function FinanceDashboardPage() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const { isAdmin } = useRole();

  const { data: summary } = useQuery({ queryKey: ["stats", "summary"], queryFn: fetchSummary });
  const { data: org } = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });
  const { data: timeseries } = useQuery({
    queryKey: ["stats", "payments-timeseries"],
    queryFn: fetchPaymentsTimeseries,
  });
  const { data: byPartner } = useQuery({
    queryKey: ["stats", "donations-by-partner"],
    queryFn: fetchDonationsByPartner,
  });
  const { data: completed } = useQuery({
    queryKey: ["payments", { status: "completed", limit: 8 }],
    queryFn: () => listPayments({ status: "completed", limit: 8 }),
  });
  const { data: overdue } = useQuery({
    queryKey: ["payments", { donorOverdue: true, count: true }],
    queryFn: () => listPayments({ donor_overdue: true, limit: 1 }),
  });
  // Bank transfers are admin-only on the server; finance users see "—".
  const { data: pendingTransfers } = useQuery({
    queryKey: ["bank-transfers", { status: "pending", count: true }],
    queryFn: () => listBankTransfers({ status: "pending" }),
    enabled: isAdmin,
  });
  const { data: completedTransfers } = useQuery({
    queryKey: ["bank-transfers", { status: "completed", count: true }],
    queryFn: () => listBankTransfers({ status: "completed" }),
    enabled: isAdmin,
  });
  const { data: allTransfers } = useQuery({
    queryKey: ["bank-transfers"],
    queryFn: () => listBankTransfers(),
    enabled: isAdmin,
  });

  const currency = org?.default_currency ?? null;
  const received30d = summary ? Number(summary.payments_last_30d_total) : null;
  const transferCount = (s: string | undefined) =>
    !isAdmin ? null : s === "pending" ? pendingTransfers?.total ?? null : completedTransfers?.total ?? null;

  return (
    <div className="fin-page">
      <div className="fin-head">
        <div>
          <h1>{t("finance.dashboard.title")}</h1>
          <p>{t("finance.dashboard.subtitle")}</p>
        </div>
        <div className="fin-head-actions">
          <Link to="/admin/finance/reports" className="fin-btn-secondary">
            <FinIcon>{FIN_ICONS.download}</FinIcon>
            {t("finance.dashboard.exportDaily")}
          </Link>
          {isAdmin && (
            <Link to="/admin/bank-transfers" className="fin-btn-primary">
              <FinIcon>{FIN_ICONS.exchange}</FinIcon>
              {t("finance.dashboard.createTransfer")}
            </Link>
          )}
        </div>
      </div>

      {/* ── Treasury hero ──────────────────────────────────────────── */}
      <section className="fin-treasury">
        <div className="fin-treasury-row">
          <div>
            <div className="fin-lbl">{t("finance.dashboard.treasuryLabel")}</div>
            <div className="fin-balance">
              {received30d == null ? (
                <Skeleton className="h-12 w-48" />
              ) : (
                <>
                  <span className="fin-latin">{fmt.money(received30d)}</span>
                  {currency && <span className="unit">{currency}</span>}
                </>
              )}
            </div>
            <div className="fin-sub-bal">{t("finance.dashboard.treasuryNote")}</div>
            <div className="fin-treasury-splits">
              <Split
                label={t("finance.dashboard.splitReceivedCount")}
                value={summary ? fmt.int(summary.payments_last_30d_count) : DASH}
              />
              <Split
                label={t("finance.dashboard.splitOverdue")}
                value={overdue ? fmt.int(overdue.total) : DASH}
              />
              <Split
                label={t("finance.dashboard.splitPendingTransfers")}
                value={transferCount("pending") == null ? DASH : fmt.int(transferCount("pending")!)}
              />
              <Split
                label={t("finance.dashboard.splitCompletedTransfers")}
                value={transferCount("completed") == null ? DASH : fmt.int(transferCount("completed")!)}
              />
            </div>
          </div>
          <div className="fin-treasury-right">
            <h2>{t("finance.dashboard.cashflowTitle")}</h2>
            {!timeseries ? (
              <Skeleton className="h-[180px] w-full" />
            ) : timeseries.months.length === 0 ? (
              <div className="fin-cash-axis" style={{ opacity: 0.85, marginTop: 24 }}>
                {t("finance.dashboard.cashflowEmpty")}
              </div>
            ) : (
              <CashChart months={timeseries.months} fmt={fmt} />
            )}
            {timeseries && timeseries.months.length > 0 && (
              <div className="fin-cash-legend">
                <span>
                  <span className="dot" style={{ background: "#fcd34d" }} />
                  {t("finance.dashboard.legendIn")}{" "}
                  <strong className="fin-latin">
                    {fmt.compact(
                      timeseries.months.reduce((s, m) => s + Number(m.payments_total), 0),
                    )}
                  </strong>
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      {!summary ? (
        <div style={{ marginBottom: 18 }}>
          <StatGridSkeleton cards={4} />
        </div>
      ) : (
        <section className="fin-kpi-strip" aria-label={t("finance.dashboard.title")}>
          <Kpi
            icon={FIN_ICONS.dollar}
            label={t("finance.dashboard.kpiMonthRevenue")}
            value={<Money amount={summary.payments_last_30d_total} currency={currency} />}
            foot={t("finance.dashboard.kpiMonthRevenueFoot", {
              count: summary.payments_last_30d_count,
            })}
          />
          <Kpi
            icon={FIN_ICONS.clock}
            label={t("finance.dashboard.kpiPendingTransfers")}
            value={transferCount("pending") == null ? DASH : fmt.int(transferCount("pending")!)}
            foot={
              isAdmin
                ? t("finance.dashboard.kpiPendingTransfersFoot", {
                    count: transferCount("pending") ?? 0,
                  })
                : t("finance.dashboard.adminOnlyTransfers")
            }
            tone={transferCount("pending") ? "alert" : undefined}
          />
          <Kpi
            icon={FIN_ICONS.alert}
            label={t("finance.dashboard.kpiOverdue")}
            value={overdue ? fmt.int(overdue.total) : DASH}
            foot={t("finance.dashboard.kpiOverdueFoot")}
            tone={overdue && overdue.total > 0 ? "danger" : undefined}
          />
          <Kpi
            icon={FIN_ICONS.exchange}
            label={t("finance.dashboard.kpiCompletedTransfers")}
            value={transferCount("completed") == null ? DASH : fmt.int(transferCount("completed")!)}
            foot={
              isAdmin
                ? t("finance.dashboard.kpiCompletedTransfersFoot")
                : t("finance.dashboard.adminOnlyTransfers")
            }
          />
        </section>
      )}

      {/* ── Quick actions ──────────────────────────────────────────── */}
      <section className="fin-qa-grid">
        {isAdmin && (
          <QuickAction
            to="/admin/bank-transfers"
            tone="fin"
            icon={FIN_ICONS.exchange}
            name={t("finance.dashboard.qaCreateTransfer")}
            sub={t("finance.dashboard.qaCreateTransferSub")}
          />
        )}
        <QuickAction
          to="/admin/finance/import"
          tone="info"
          icon={FIN_ICONS.upload}
          name={t("finance.dashboard.qaImport")}
          sub={t("finance.dashboard.qaImportSub")}
        />
        <QuickAction
          to="/admin/finance/overdue"
          tone="warn"
          icon={FIN_ICONS.clock}
          name={t("finance.dashboard.qaOverdue")}
          sub={t("finance.dashboard.qaOverdueSub")}
        />
        <QuickAction
          to="/admin/finance/reports"
          tone="purple"
          icon={FIN_ICONS.bars}
          name={t("finance.dashboard.qaReports")}
          sub={t("finance.dashboard.qaReportsSub")}
        />
      </section>

      {/* ── Incoming payments + Partner transfers ──────────────────── */}
      <section className="fin-grid-2">
        <div className="fin-card">
          <header className="fin-card-head">
            <div>
              <h2>{t("finance.dashboard.incomingTitle")}</h2>
              <p>{t("finance.dashboard.incomingSub")}</p>
            </div>
            <Link to="/admin/payments" className="fin-head-link">
              {t("finance.dashboard.allPayments")}
              <FinIcon>{FIN_ICONS.chevronStart}</FinIcon>
            </Link>
          </header>
          {!completed ? (
            <div className="fin-card-body">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : completed.items.length === 0 ? (
            <div className="fin-empty">
              <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
              <div className="fin-empty-title">{t("common.empty")}</div>
            </div>
          ) : (
            <div className="fin-pay-list">
              {completed.items.map((p) => (
                <div className="fin-pay-row" key={p.id}>
                  <div className="fin-pay-method">
                    <FinIcon>{FIN_ICONS.receipt}</FinIcon>
                  </div>
                  <div className="fin-pay-info">
                    <div className="nm">
                      {t(`payments.methods.${p.payment_method}`, p.payment_method)}
                    </div>
                    <div className="meta">
                      <span className="id">{p.code}</span>
                      <span className="dot">·</span>
                      <span>{p.completed_at ? p.completed_at.slice(0, 10) : DASH}</span>
                    </div>
                  </div>
                  <div className="fin-pay-amt">
                    <Money amount={p.amount} currency={p.currency} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="fin-card">
          <header className="fin-card-head">
            <div>
              <h2>{t("finance.dashboard.transfersTitle")}</h2>
              <p>{t("finance.dashboard.transfersSub")}</p>
            </div>
            {isAdmin && (
              <Link to="/admin/bank-transfers" className="fin-head-link">
                {t("finance.dashboard.allTransfers")}
                <FinIcon>{FIN_ICONS.chevronStart}</FinIcon>
              </Link>
            )}
          </header>
          {!isAdmin ? (
            <div className="fin-empty">
              <FinIcon className="fin-icon">{FIN_ICONS.exchange}</FinIcon>
              <div className="fin-empty-title">{t("finance.dashboard.adminOnlyTransfers")}</div>
            </div>
          ) : !allTransfers ? (
            <div className="fin-card-body">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : allTransfers.items.length === 0 ? (
            <div className="fin-empty">
              <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
              <div className="fin-empty-title">{t("common.empty")}</div>
            </div>
          ) : (
            <div>
              {allTransfers.items.slice(0, 6).map((tx) => (
                <div className="fin-tr-row" key={tx.id}>
                  <div className="fin-tr-logo">{tx.code.slice(-2)}</div>
                  <div className="fin-tr-info">
                    <div className="nm">{tx.bank_name ?? t("bankTransfers.title")}</div>
                    <div className="meta">
                      <span className="id">{tx.code}</span> ·{" "}
                      {t(`bankTransfers.statuses.${tx.status}`, tx.status)}
                    </div>
                  </div>
                  <div className="fin-tr-right">
                    <div className="fin-tr-amt">
                      <Money amount={tx.amount} currency={tx.currency} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Donations by partner ───────────────────────────────────── */}
      <section className="fin-card" style={{ marginBottom: 18 }}>
        <header className="fin-card-head">
          <div>
            <h2>{t("finance.dashboard.orphanBalTitle")}</h2>
            <p>{t("finance.dashboard.orphanBalSub")}</p>
          </div>
        </header>
        {!byPartner ? (
          <div className="fin-card-body">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : byPartner.items.length === 0 ? (
          <div className="fin-empty">
            <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
            <div className="fin-empty-title">{t("common.empty")}</div>
          </div>
        ) : (
          <div className="fin-orph-bal">
            {(() => {
              const max = Math.max(...byPartner.items.map((p) => Number(p.payments_total)), 1);
              return byPartner.items.map((p) => (
                <div className="fin-bal-row" key={p.partner_id}>
                  <div className="lab">
                    <span className="logo">{p.partner_name.slice(0, 1)}</span>
                    {p.partner_name}
                  </div>
                  <div className="bar">
                    <div
                      className="fill"
                      style={{ inlineSize: `${(Number(p.payments_total) / max) * 100}%` }}
                    />
                  </div>
                  <div className="num">
                    <Money amount={p.payments_total} currency={currency} />
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </section>

      {/* TODO(backend): live FX rates have no endpoint yet. */}
      <div className="fin-notice">
        <FinIcon>{FIN_ICONS.info}</FinIcon>
        {t("finance.dashboard.fxNote")}
      </div>
    </div>
  );
}

type Fmt = ReturnType<typeof useFmt>;

function Split({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fin-treasury-split">
      <div className="sl">{label}</div>
      <div className="sv fin-latin">{value}</div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  foot,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  foot: string;
  tone?: "alert" | "danger";
}) {
  return (
    <article className={`fin-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="lbl">
        <FinIcon>{icon}</FinIcon>
        {label}
      </span>
      <div className="val">{value}</div>
      <div className="foot">{foot}</div>
    </article>
  );
}

function QuickAction({
  to,
  tone,
  icon,
  name,
  sub,
}: {
  to: string;
  tone: string;
  icon: ReactNode;
  name: string;
  sub: string;
}) {
  return (
    <Link to={to} className="fin-qa">
      <div className={`ic ${tone}`}>
        <FinIcon className="fin-icon">{icon}</FinIcon>
      </div>
      <div>
        <div className="nm">{name}</div>
        <div className="sub">{sub}</div>
      </div>
      <FinIcon className="fin-icon arrow">{FIN_ICONS.chevronStart}</FinIcon>
    </Link>
  );
}

// Monthly inflow area chart from the real payments timeseries. Wrapped in a
// dir="ltr" container so time reads oldest→newest, consistent with labels.
function CashChart({ months, fmt }: { months: { month: string; payments_total: string }[]; fmt: Fmt }) {
  const { t } = useTranslation();
  const W = 600;
  const H = 150;
  const vals = months.map((m) => Number(m.payments_total));
  const max = Math.max(...vals, 1);
  const n = months.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => 10 + (1 - v / max) * (H - 20);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`);
  const line = `M${pts.join(" L")}`;
  const area = `M${x(0)},${H} L${pts.join(" L")} L${x(n - 1)},${H} Z`;

  return (
    <>
      <div className="fin-cash-chart" dir="ltr" role="img" aria-label={t("finance.dashboard.cashflowTitle")}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="fin-cash-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fcd34d" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#fcd34d" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#fin-cash-grad)" />
          <path d={line} stroke="#fcd34d" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="fin-cash-axis" dir="ltr">
        {months.map((m) => (
          <span key={m.month}>{fmt.monthShort(new Date(m.month))}</span>
        ))}
      </div>
    </>
  );
}
