import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmReceiptDialog } from "@/components/ConfirmReceiptDialog";
import { Icon, PM_ICONS } from "@/components/partner/icons";
import { PartnerTopbar } from "@/components/partner/PartnerTopbar";
import { useRole } from "@/hooks/useRole";
import { listBankTransfers, type BankTransfer } from "@/lib/bankTransfers";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

import "./PartnerTransfersPage.css";

type Bucket = "awaiting" | "confirmed" | "scheduled";

const QK = ["bank-transfers", { scope: "pm-transfers" }] as const;

// Partner-view buckets derived from the real transfer lifecycle:
//  • awaiting  — executed by the parent org, not yet partner-confirmed
//  • confirmed — partner has acknowledged receipt
//  • scheduled — not yet executed (pending / approved / processing)
function bucketOf(tx: BankTransfer): Bucket {
  if (tx.confirmed_by_partner_at) return "confirmed";
  if (tx.status === "completed") return "awaiting";
  if (tx.status === "pending" || tx.status === "approved" || tx.status === "processing")
    return "scheduled";
  return "scheduled";
}

export function PartnerTransfersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isPartnerApprover } = useRole();
  const [bucket, setBucket] = useState<Bucket>("awaiting");
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const transfersQ = useQuery({ queryKey: QK, queryFn: () => listBankTransfers() });
  const partnersQ = useQuery({
    queryKey: ["partners", { includeInactive: false }],
    queryFn: () => listPartners(false),
  });

  const items = useMemo(() => transfersQ.data?.items ?? [], [transfersQ.data]);
  const counts = useMemo(() => {
    const c = { awaiting: 0, confirmed: 0, scheduled: 0 };
    for (const tx of items) c[bucketOf(tx)]++;
    return c;
  }, [items]);
  const visible = items.filter((tx) => bucketOf(tx) === bucket);

  // Accumulated balance awaiting partner confirmation (sum of executed,
  // unconfirmed transfers). Grouped by currency so we never add KWD to ₪.
  const awaitingByCurrency = useMemo(() => {
    const m = new Map<string, number>();
    for (const tx of items) {
      if (bucketOf(tx) === "awaiting") {
        m.set(tx.currency, (m.get(tx.currency) ?? 0) + Number(tx.amount || 0));
      }
    }
    return m;
  }, [items]);

  const partnerName = (id: string): string => {
    const p = partnersQ.data?.items.find((x) => x.id === id);
    if (!p) return id.slice(0, 8);
    return i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar;
  };

  const fmtMoney = (n: number) =>
    n.toLocaleString(i18n.language, { maximumFractionDigits: 0 });

  const balanceLabel = [...awaitingByCurrency.entries()]
    .map(([cur, amt]) => `${fmtMoney(amt)} ${cur}`)
    .join(" · ");

  return (
    <>
      <PartnerTopbar
        title={t("partner.transfers.title")}
        subtitle={t("partner.transfers.subtitle")}
        actions={
          <>
            <button type="button" className="pm-btn-secondary">
              <Icon>{PM_ICONS.download}</Icon>
              {t("partner.transfers.export")}
            </button>
            <button type="button" className="pm-btn-primary">
              <Icon>{PM_ICONS.clock}</Icon>
              {t("partner.transfers.notifyPolicy")}
            </button>
          </>
        }
      />

      <div className="pm-page">
        {/* Bank account info. TODO(backend): no partner bank-account
            endpoint; account identifiers are shown as placeholders. */}
        <div className="pm-account-bar">
          <div className="pm-account-icon">
            <Icon className="pm-icon">{PM_ICONS.building}</Icon>
          </div>
          <div className="pm-account-text">
            <div className="pm-account-label">{t("partner.transfers.accountLabel")}</div>
            <div className="pm-account-name">{t("partner.transfers.accountNamePlaceholder")}</div>
            <div className="pm-account-meta">
              <span>{t("partner.transfers.accountNumber")}: —</span>
              <span className="pm-dot" />
              <span>{t("partner.transfers.beneficiary")}: —</span>
            </div>
          </div>
          <div className="pm-account-balance">
            <div className="pm-account-balance-label">
              {t("partner.transfers.accumulatedBalance")}
            </div>
            <div className="pm-account-balance-num pm-latin">
              {balanceLabel || "—"}
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="pm-trans-kpis">
          <div className="pm-trans-kpi">
            <div className="pm-trans-kpi-label">
              <Icon>{PM_ICONS.clock}</Icon>
              {t("partner.transfers.kpi.awaiting")}
            </div>
            <div className="pm-trans-kpi-num">
              <span className="pm-latin">{counts.awaiting}</span>
              <span className="pm-unit">{t("partner.transfers.unitTransfers")}</span>
            </div>
            <div className="pm-trans-kpi-foot">
              {t("partner.transfers.kpi.awaitingFoot")}
            </div>
          </div>
          <div className="pm-trans-kpi">
            <div className="pm-trans-kpi-label">
              <Icon>{PM_ICONS.check}</Icon>
              {t("partner.transfers.kpi.confirmed")}
            </div>
            <div className="pm-trans-kpi-num">
              <span className="pm-latin">{counts.confirmed}</span>
              <span className="pm-unit">{t("partner.transfers.unitTransfers")}</span>
            </div>
            <div className="pm-trans-kpi-foot">{t("partner.transfers.kpi.confirmedFoot")}</div>
          </div>
          <div className="pm-trans-kpi">
            <div className="pm-trans-kpi-label">
              <Icon>{PM_ICONS.calendar}</Icon>
              {t("partner.transfers.kpi.scheduled")}
            </div>
            <div className="pm-trans-kpi-num">
              <span className="pm-latin">{counts.scheduled}</span>
              <span className="pm-unit">{t("partner.transfers.unitTransfers")}</span>
            </div>
            <div className="pm-trans-kpi-foot">{t("partner.transfers.kpi.scheduledFoot")}</div>
          </div>
          {/* TODO(backend): no SLA / avg-confirmation-time metric exposed. */}
          <div className="pm-trans-kpi">
            <div className="pm-trans-kpi-label">
              <Icon>{PM_ICONS.star}</Icon>
              {t("partner.transfers.kpi.avgTime")}
            </div>
            <div className="pm-trans-kpi-num">
              <span className="pm-latin">—</span>
            </div>
            <div className="pm-trans-kpi-foot">{t("partner.transfers.kpi.avgTimeFoot")}</div>
          </div>
        </div>

        {/* Status tabs */}
        <div className="pm-trans-filter">
          <div className="pm-status-tabs" role="tablist" aria-label={t("partner.transfers.title")}>
            <StatusTab
              active={bucket === "awaiting"}
              urgent
              onClick={() => setBucket("awaiting")}
              label={t("partner.transfers.tabs.awaiting")}
              count={counts.awaiting}
            />
            <StatusTab
              active={bucket === "confirmed"}
              onClick={() => setBucket("confirmed")}
              label={t("partner.transfers.tabs.confirmed")}
              count={counts.confirmed}
            />
            <StatusTab
              active={bucket === "scheduled"}
              onClick={() => setBucket("scheduled")}
              label={t("partner.transfers.tabs.scheduled")}
              count={counts.scheduled}
            />
          </div>
        </div>

        {/* Transfers list */}
        {transfersQ.isLoading && (
          <div className="pm-state">{t("common.loading")}</div>
        )}
        {transfersQ.error && (
          <div className="pm-state error">{t("common.loadError")}</div>
        )}
        {!transfersQ.isLoading && !transfersQ.error && visible.length === 0 && (
          <div className="pm-empty">
            <Icon className="pm-icon">{PM_ICONS.check}</Icon>
            <h3>{t("partner.transfers.empty.title")}</h3>
            <p>{t("partner.transfers.empty.body")}</p>
          </div>
        )}

        <div className="pm-transfers">
          {visible.map((tx) => (
            <TransferCard
              key={tx.id}
              tx={tx}
              bucket={bucket}
              partnerName={partnerName(tx.partner_organization_id)}
              canConfirm={isPartnerApprover && bucket === "awaiting"}
              onConfirm={() => setConfirmTarget(tx.id)}
            />
          ))}
        </div>
      </div>

      {confirmTarget && (
        <ConfirmReceiptDialog
          transferId={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onConfirmed={async () => {
            await qc.invalidateQueries({ queryKey: ["bank-transfers"] });
            toast.success(t("bankTransfers.confirmed"));
            setConfirmTarget(null);
          }}
        />
      )}
    </>
  );
}

function StatusTab({
  active,
  urgent,
  onClick,
  label,
  count,
}: {
  active: boolean;
  urgent?: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`pm-status-tab${active ? " active" : ""}${urgent ? " urgent" : ""}`}
      onClick={onClick}
    >
      {label}
      <span className="pm-count pm-latin">{count}</span>
    </button>
  );
}

function TransferCard({
  tx,
  bucket,
  partnerName,
  canConfirm,
  onConfirm,
}: {
  tx: BankTransfer;
  bucket: Bucket;
  partnerName: string;
  canConfirm: boolean;
  onConfirm: () => void;
}) {
  const { t, i18n } = useTranslation();
  const statusClass =
    bucket === "confirmed" ? "received" : bucket === "scheduled" ? "scheduled" : "pending";
  const statusLabel =
    bucket === "confirmed"
      ? t("partner.transfers.status.received")
      : bucket === "scheduled"
        ? t("partner.transfers.status.scheduled")
        : t("partner.transfers.status.awaiting");
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(i18n.language);

  return (
    <article className={`pm-transfer-card${bucket === "awaiting" ? " urgent" : ""}`}>
      <div className="pm-t-head">
        <div className="pm-t-head-info">
          <span className="pm-t-code">
            <Icon>{PM_ICONS.dollar}</Icon>
            <span className="pm-latin">{tx.code}</span>
          </span>
          <div className="pm-t-title">{partnerName}</div>
          <div className="pm-t-meta">
            <span>
              {t("partner.transfers.period")}:{" "}
              <span className="pm-latin">
                {fmtDate(tx.period_start)} → {fmtDate(tx.period_end)}
              </span>
            </span>
            <span className="pm-dot" />
            <span className={`pm-t-status ${statusClass}`}>
              <span className="pm-dot" />
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="pm-t-amount">
          <div className="pm-t-amount-label">{t("bankTransfers.amount")}</div>
          <div className="pm-t-amount-num pm-latin">
            {Number(tx.amount).toLocaleString(i18n.language)}
            <span className="pm-unit">{tx.currency}</span>
          </div>
        </div>
      </div>

      <div className="pm-t-breakdown">
        <div>
          <div className="pm-t-stat-label">{t("bankTransfers.bankName")}</div>
          <div className="pm-t-stat-num">{tx.bank_name ?? "—"}</div>
        </div>
        <div>
          <div className="pm-t-stat-label">{t("partner.transfers.reference")}</div>
          <div className="pm-t-stat-num pm-latin">{tx.bank_reference ?? "—"}</div>
        </div>
        <div>
          <div className="pm-t-stat-label">{t("partner.transfers.issuedAt")}</div>
          <div className="pm-t-stat-num pm-latin">{fmtDate(tx.created_at)}</div>
        </div>
        <div>
          <div className="pm-t-stat-label">{t("bankTransfers.status")}</div>
          <div className="pm-t-stat-num success">
            {t(`bankTransfers.statuses.${tx.status}`, tx.status)}
          </div>
        </div>
      </div>

      <div className="pm-t-actions">
        <div className="pm-t-actions-left">
          {tx.notes ? <span>{tx.notes}</span> : <span />}
        </div>
        <div className="pm-t-actions-right">
          {canConfirm && (
            <button type="button" className="pm-act-btn primary" onClick={onConfirm}>
              <Icon>{PM_ICONS.check}</Icon>
              {t("bankTransfers.confirmReceipt")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
