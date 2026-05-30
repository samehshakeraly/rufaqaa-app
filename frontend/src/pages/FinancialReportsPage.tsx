import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Skeleton } from "@/components/Skeleton";
import { fetchOrganization } from "@/lib/organization";
import { exportPaymentsCsv } from "@/lib/payments";
import {
  fetchDonationsByPartner,
  fetchPaymentsTimeseries,
  fetchSummary,
} from "@/lib/stats";
import { toast } from "@/store/toasts";

import "./finance.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

function firstOfYearISO(): string {
  return new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function FinancialReportsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [from, setFrom] = useState(firstOfYearISO());
  const [to, setTo] = useState(todayISO());

  const { data: org } = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });
  const { data: summary } = useQuery({ queryKey: ["stats", "summary"], queryFn: fetchSummary });
  const { data: timeseries } = useQuery({
    queryKey: ["stats", "payments-timeseries"],
    queryFn: fetchPaymentsTimeseries,
  });
  const { data: byPartner } = useQuery({
    queryKey: ["stats", "donations-by-partner"],
    queryFn: fetchDonationsByPartner,
  });

  const baseCurrency = org?.default_currency ?? null;

  // Range-accurate "total received": sum the monthly timeseries points whose
  // month falls inside the selected window (only the timeseries endpoint is
  // date-decomposable; partner totals use a fixed server window).
  const totalReceived = (timeseries?.months ?? [])
    .filter((m) => m.month >= from.slice(0, 7) + "-01" && m.month <= to)
    .reduce((sum, m) => sum + Number(m.payments_total), 0);
  const totalTransferred = (byPartner?.items ?? []).reduce(
    (sum, p) => sum + Number(p.payments_total),
    0,
  );
  const netRetained = totalReceived - totalTransferred;

  async function onExportCsv() {
    try {
      const blob = await exportPaymentsCsv({ status: "completed" });
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
  const comingSoon = () => toast.info(t("finance.reports.generateUnavailable"));

  return (
    <div className="fin-page">
      <div className="fin-head">
        <div>
          <h1>{t("finance.reports.title")}</h1>
          <p>{t("finance.reports.subtitle")}</p>
        </div>
        <div className="fin-head-actions">
          <button type="button" className="fin-btn-secondary" onClick={comingSoon}>
            <FinIcon>{FIN_ICONS.fileText}</FinIcon>
            {t("finance.reports.savedLibrary")}
          </button>
          <button type="button" className="fin-btn-primary" onClick={comingSoon}>
            <FinIcon>{FIN_ICONS.plus}</FinIcon>
            {t("finance.reports.customReport")}
          </button>
        </div>
      </div>

      {/* ── Year hero with the live range + real stats ─────────────── */}
      <section className="fin-year-hero">
        <div className="fin-yh-row">
          <div>
            <div className="lbl">{t("finance.reports.yearLabel")}</div>
            <div className="ttl">{t("finance.reports.yearTitle")}</div>
            <div className="ds">{t("finance.reports.yearDesc")}</div>
          </div>
          <div className="fin-yh-range">
            <label className="fin-field">
              <span className="fin-field-label">{t("finance.reports.from")}</span>
              <input
                type="date"
                className="fin-input"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="fin-field">
              <span className="fin-field-label">{t("finance.reports.to")}</span>
              <input
                type="date"
                className="fin-input"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="fin-yh-stats">
          <HeroStat
            label={t("finance.reports.statRevenue")}
            value={
              timeseries ? <Money amount={totalReceived} currency={baseCurrency} /> : null
            }
          />
          <HeroStat
            label={t("finance.reports.statExpenses")}
            value={
              byPartner ? <Money amount={totalTransferred} currency={baseCurrency} /> : null
            }
          />
          <HeroStat
            label={t("finance.reports.statBalance")}
            value={
              timeseries && byPartner ? (
                <Money amount={netRetained} currency={baseCurrency} />
              ) : null
            }
          />
          <HeroStat
            label={t("finance.reports.statZakat")}
            value={summary ? summary.donors_total.toLocaleString(lang) : null}
          />
        </div>
      </section>

      {/* ── Statutory / standard reports grid ──────────────────────── */}
      <div className="fin-section-h">
        <div className="ttl">
          <FinIcon className="fin-icon">{FIN_ICONS.star}</FinIcon>
          {t("finance.reports.sectionStatutory")}
        </div>
        <span className="fin-card-note">{t("finance.reports.sectionStatutoryNote")}</span>
      </div>

      <section className="fin-rep-grid">
        {/* Revenue — the one report we can actually export today (CSV). */}
        <ReportCard
          stripe="rev"
          icon={FIN_ICONS.trending}
          name={t("finance.reports.repRevenue")}
          desc={t("finance.reports.repRevenueDesc")}
          flags={[
            ["mon", t("finance.reports.flagMonthly")],
            ["qtr", t("finance.reports.flagQuarterly")],
            ["ann", t("finance.reports.flagAnnual")],
          ]}
          buttons={
            <button type="button" className="fin-dl-btn" onClick={onExportCsv}>
              {t("finance.reports.exportCsvShort")}
            </button>
          }
        />
        <ReportCard
          featured
          stripe="zak"
          iconTone="zak"
          icon={FIN_ICONS.dollar}
          name={t("finance.reports.repZakat")}
          desc={t("finance.reports.repZakatDesc")}
          flags={[
            ["ann", t("finance.reports.flagAnnual")],
            ["req", t("finance.reports.flagRequired")],
          ]}
          onGenerate={comingSoon}
        />
        <ReportCard
          stripe="exp"
          iconTone="exp"
          icon={FIN_ICONS.exchange}
          name={t("finance.reports.repExpenses")}
          desc={t("finance.reports.repExpensesDesc")}
          flags={[
            ["mon", t("finance.reports.flagMonthly")],
            ["qtr", t("finance.reports.flagQuarterly")],
          ]}
          onGenerate={comingSoon}
        />
        <ReportCard
          stripe="bal"
          iconTone="bal"
          icon={FIN_ICONS.balance}
          name={t("finance.reports.repBalance")}
          desc={t("finance.reports.repBalanceDesc")}
          flags={[
            ["ann", t("finance.reports.flagAnnual")],
            ["qtr", t("finance.reports.flagQuarterly")],
          ]}
          onGenerate={comingSoon}
        />
        <ReportCard
          stripe="rev"
          icon={FIN_ICONS.bars}
          name={t("finance.reports.repCashflow")}
          desc={t("finance.reports.repCashflowDesc")}
          flags={[
            ["mon", t("finance.reports.flagMonthly")],
            ["qtr", t("finance.reports.flagQuarterly")],
          ]}
          onGenerate={comingSoon}
        />
        <ReportCard
          stripe="don"
          iconTone="don"
          icon={FIN_ICONS.heart}
          name={t("finance.reports.repDonors")}
          desc={t("finance.reports.repDonorsDesc")}
          flags={[
            ["mon", t("finance.reports.flagMonthly")],
            ["ann", t("finance.reports.flagAnnual")],
          ]}
          onGenerate={comingSoon}
        />
        <ReportCard
          stripe="aud"
          iconTone="aud"
          icon={FIN_ICONS.fileText}
          name={t("finance.reports.repAudit")}
          desc={t("finance.reports.repAuditDesc")}
          flags={[["qtr", t("finance.reports.flagQuarterly")], ["req", t("finance.reports.flagRequired")]]}
          onGenerate={comingSoon}
        />
      </section>

      {/* ── Payments by partner (real) ─────────────────────────────── */}
      <div className="fin-section-h">
        <div className="ttl">
          <FinIcon className="fin-icon">{FIN_ICONS.users}</FinIcon>
          {t("finance.reports.byPartner")}
        </div>
        {byPartner && (
          <span className="fin-card-note">
            {t("finance.reports.windowHint", { days: byPartner.window_days })}
          </span>
        )}
      </div>

      <section className="fin-tbl-card">
        {!byPartner && (
          <div className="fin-card-body">
            <Skeleton className="h-32 w-full" />
          </div>
        )}
        {byPartner && byPartner.items.length === 0 && (
          <div className="fin-empty">
            <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
            <div className="fin-empty-title">{t("finance.reports.byPartnerEmpty")}</div>
          </div>
        )}
        {byPartner && byPartner.items.length > 0 && (
          <div className="fin-tbl-scroll">
            <table className="fin-table">
              <caption className="sr-only">{t("finance.reports.byPartner")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("finance.reports.partner")}</th>
                  <th scope="col" className="num-h">
                    {t("finance.reports.transactions")}
                  </th>
                  <th scope="col" className="num-h">
                    {t("finance.reports.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {byPartner.items.map((p) => (
                  <tr key={p.partner_id}>
                    <td>
                      <span className="fin-cell-id" style={{ marginInlineEnd: 8 }}>
                        {p.partner_code}
                      </span>
                      {p.partner_name}
                    </td>
                    <td className="fin-cell-num">{p.payments_count.toLocaleString(lang)}</td>
                    <td className="fin-amt">
                      <Money amount={p.payments_total} currency={baseCurrency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="fin-card-note">{t("finance.reports.exportNote")}</p>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fin-yh-stat">
      <div className="l">{label}</div>
      <div className="v">{value ?? <Skeleton className="h-5 w-20" />}</div>
    </div>
  );
}

function ReportCard({
  stripe,
  iconTone,
  icon,
  name,
  desc,
  flags,
  buttons,
  onGenerate,
  featured,
}: {
  stripe: string;
  iconTone?: string;
  icon: ReactNode;
  name: string;
  desc: string;
  flags: [string, string][];
  buttons?: ReactNode;
  onGenerate?: () => void;
  featured?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <article className={`fin-rep-card${featured ? " featured" : ""}`}>
      <span className={`fin-rep-stripe ${stripe}`} />
      <header className="fin-rep-head">
        <div className={`fin-rep-icon ${iconTone ?? "rev"}`}>
          <FinIcon className="fin-icon">{icon}</FinIcon>
        </div>
        <div className="fin-rep-info">
          <div className="nm">{name}</div>
          <div className="ds">{desc}</div>
        </div>
      </header>
      <div className="fin-rep-body">
        <div className="fin-rep-flags">
          {flags.map(([cls, label]) => (
            <span key={label} className={`fin-flag ${cls}`}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <footer className="fin-rep-foot">
        <span className="last" />
        <div className="fin-foot-btns">
          {buttons ?? (
            <>
              <button type="button" className="fin-dl-btn pdf" onClick={onGenerate}>
                {t("finance.reports.pdf")}
              </button>
              <button type="button" className="fin-dl-btn" onClick={onGenerate}>
                {t("finance.reports.excel")}
              </button>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}
