import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon, PM_ICONS } from "@/components/partner/icons";
import { PartnerTopbar } from "@/components/partner/PartnerTopbar";
import { ReasonDialog } from "@/components/partner/ReasonDialog";
import { useRole } from "@/hooks/useRole";
import {
  approveBankTransfer,
  listBankTransfers,
} from "@/lib/bankTransfers";
import { approveOrphan, listOrphans, rejectOrphan, type Orphan } from "@/lib/orphans";
import { listReports, transitionReport, type Report } from "@/lib/reports";
import { toast } from "@/store/toasts";

import "./PartnerApprovalsPage.css";

type TabKey = "orphans" | "reports" | "media" | "bank";

// Approval-center queues. Each tab reads a real slice of an existing
// endpoint (except `media`, which has no moderation-queue endpoint yet).
const ORPHAN_QK = ["orphans", { case_status: "pending_review", scope: "pm-approvals" }] as const;
const REPORTS_QK = ["reports", { status: "pending_partner_approval", scope: "pm-approvals" }] as const;
const BANK_QK = ["bank-transfers", { status: "pending", scope: "pm-approvals" }] as const;

function axiosMsg(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

export function PartnerApprovalsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isPartnerApprover } = useRole();
  const [tab, setTab] = useState<TabKey>("orphans");
  const [rejecting, setRejecting] = useState<{ id: string } | null>(null);

  const orphansQ = useQuery({
    queryKey: ORPHAN_QK,
    queryFn: () =>
      listOrphans({ case_status: "pending_review", limit: 50 }),
  });
  const reportsQ = useQuery({
    queryKey: REPORTS_QK,
    queryFn: () =>
      listReports({ status: "pending_partner_approval", limit: 50 }),
  });
  const bankQ = useQuery({
    queryKey: BANK_QK,
    queryFn: () => listBankTransfers({ status: "pending" }),
  });

  const orphanCount = orphansQ.data?.total ?? orphansQ.data?.items.length;
  const reportCount = reportsQ.data?.total ?? reportsQ.data?.items.length;
  const bankCount = bankQ.data?.total ?? bankQ.data?.items.length;

  const approveOrphanM = useMutation({
    mutationFn: (id: string) => approveOrphan(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orphans"] });
      toast.success(t("orphans.actions.approved"));
    },
    onError: (err) => toast.error(axiosMsg(err, t("common.createError"))),
  });
  const rejectOrphanM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectOrphan(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orphans"] });
      toast.success(t("orphans.actions.rejected"));
      setRejecting(null);
    },
    onError: (err) => toast.error(axiosMsg(err, t("common.createError"))),
  });
  const approveReportM = useMutation({
    mutationFn: (id: string) => transitionReport(id, "approve-partner"),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("partner.approvals.reportApproved"));
    },
    onError: (err) => toast.error(axiosMsg(err, t("common.createError"))),
  });
  const rejectReportM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      transitionReport(id, "reject", reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("partner.approvals.reportRejected"));
      setRejecting(null);
    },
    onError: (err) => toast.error(axiosMsg(err, t("common.createError"))),
  });
  const approveBankM = useMutation({
    mutationFn: (id: string) => approveBankTransfer(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bank-transfers"] });
      toast.success(t("bankTransfers.approved"));
    },
    onError: (err) => toast.error(axiosMsg(err, t("common.createError"))),
  });

  // The reject dialog is reused for both orphans and reports; the active
  // tab decides which mutation fires.
  function submitReject(reason: string) {
    if (!rejecting) return;
    if (tab === "reports") rejectReportM.mutate({ id: rejecting.id, reason });
    else rejectOrphanM.mutate({ id: rejecting.id, reason });
  }

  const fmtNum = (n: number | undefined) =>
    n === undefined ? "—" : n.toLocaleString(i18n.language);

  return (
    <>
      <PartnerTopbar
        title={t("partner.approvals.title")}
        badge={t("partner.managerPermissions")}
        subtitle={t("partner.approvals.subtitle")}
      />

      <div className="pm-page">
        {/* KPI cards double as tab triggers */}
        <div className="pm-kpi-strip">
          <KpiCard
            active={tab === "orphans"}
            tone="orphans"
            icon={PM_ICONS.users}
            value={fmtNum(orphanCount)}
            label={t("partner.approvals.tabs.orphans")}
            onClick={() => setTab("orphans")}
          />
          <KpiCard
            active={tab === "reports"}
            tone="reports"
            icon={PM_ICONS.file}
            value={fmtNum(reportCount)}
            label={t("partner.approvals.tabs.reports")}
            onClick={() => setTab("reports")}
          />
          <KpiCard
            active={tab === "media"}
            tone="media"
            icon={PM_ICONS.image}
            value="—"
            label={t("partner.approvals.tabs.media")}
            onClick={() => setTab("media")}
          />
          <KpiCard
            active={tab === "bank"}
            tone="bank"
            icon={PM_ICONS.dollar}
            value={fmtNum(bankCount)}
            label={t("partner.approvals.tabs.bank")}
            onClick={() => setTab("bank")}
          />
        </div>

        <section className="pm-tabs-wrap">
          <div className="pm-tabs" role="tablist" aria-label={t("partner.approvals.title")}>
            <TabBtn
              active={tab === "orphans"}
              onClick={() => setTab("orphans")}
              icon={PM_ICONS.users}
              label={t("partner.approvals.tabs.orphans")}
              count={fmtNum(orphanCount)}
              urgent
            />
            <TabBtn
              active={tab === "reports"}
              onClick={() => setTab("reports")}
              icon={PM_ICONS.file}
              label={t("partner.approvals.tabs.reports")}
              count={fmtNum(reportCount)}
            />
            <TabBtn
              active={tab === "media"}
              onClick={() => setTab("media")}
              icon={PM_ICONS.image}
              label={t("partner.approvals.tabs.media")}
              count="—"
            />
            <TabBtn
              active={tab === "bank"}
              onClick={() => setTab("bank")}
              icon={PM_ICONS.dollar}
              label={t("partner.approvals.tabs.bank")}
              count={fmtNum(bankCount)}
            />
          </div>

          <div className="pm-tab-body" role="tabpanel">
            {tab === "orphans" && (
              <OrphansQueue
                query={orphansQ}
                canAct={isPartnerApprover}
                onApprove={(id) => approveOrphanM.mutate(id)}
                onReject={(id) => setRejecting({ id })}
                busy={approveOrphanM.isPending || rejectOrphanM.isPending}
              />
            )}
            {tab === "reports" && (
              <ReportsQueue
                query={reportsQ}
                canAct={isPartnerApprover}
                onApprove={(id) => approveReportM.mutate(id)}
                onReject={(id) => setRejecting({ id })}
                busy={approveReportM.isPending || rejectReportM.isPending}
              />
            )}
            {tab === "media" && <MediaQueueStub />}
            {tab === "bank" && (
              <BankQueue
                query={bankQ}
                canAct={isPartnerApprover}
                onApprove={(id) => approveBankM.mutate(id)}
                busy={approveBankM.isPending}
              />
            )}
          </div>
        </section>
      </div>

      {rejecting && (
        <ReasonDialog
          title={
            tab === "reports"
              ? t("partner.approvals.rejectReportTitle")
              : t("orphans.actions.rejectReason")
          }
          placeholder={t("orphans.actions.rejectReasonPlaceholder")}
          submitLabel={t("orphans.actions.rejectSubmit")}
          isSubmitting={rejectOrphanM.isPending || rejectReportM.isPending}
          onCancel={() => setRejecting(null)}
          onSubmit={submitReject}
        />
      )}
    </>
  );
}

// ── KPI card (tab trigger) ──────────────────────────────────────
function KpiCard({
  active,
  tone,
  icon,
  value,
  label,
  onClick,
}: {
  active: boolean;
  tone: string;
  icon: React.ReactNode;
  value: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`pm-kpi-card${active ? " active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className={`pm-kpi-icon ${tone}`}>
        <Icon className="pm-icon">{icon}</Icon>
      </div>
      <div>
        <div className="pm-kpi-num pm-latin">{value}</div>
        <div className="pm-kpi-name">{label}</div>
      </div>
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
  count,
  urgent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: string;
  urgent?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`pm-tab${active ? " active" : ""}`}
      onClick={onClick}
    >
      <Icon>{icon}</Icon>
      {label}
      <span className={`pm-tab-count${urgent ? " urgent" : ""} pm-latin`}>{count}</span>
    </button>
  );
}

// ── Shared row presenter ────────────────────────────────────────
function ApprovalRow({
  iconKind,
  glyph,
  name,
  meta,
  stamp,
  urgent,
  children,
}: {
  iconKind: "orphan" | "report" | "bank";
  glyph: React.ReactNode;
  name: React.ReactNode;
  meta: React.ReactNode;
  stamp?: React.ReactNode;
  urgent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`pm-approval-row${urgent ? " urgent" : ""}`}>
      <div className={`pm-app-icon ${iconKind}`} aria-hidden="true">
        {glyph}
      </div>
      <div className="pm-app-info">
        <div className="pm-app-name">{name}</div>
        <div className="pm-app-meta">{meta}</div>
      </div>
      {stamp ?? <span />}
      <div className="pm-app-actions">{children}</div>
    </div>
  );
}

function ageGlyph(name: string): string {
  return name.trim().charAt(0) || "•";
}

// ── Orphans queue (real) ────────────────────────────────────────
function OrphansQueue({
  query,
  canAct,
  onApprove,
  onReject,
  busy,
}: {
  query: ReturnType<typeof useQuery<{ items: Orphan[]; total: number }>>;
  canAct: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  if (query.isLoading) return <div className="pm-state">{t("common.loading")}</div>;
  if (query.error) return <div className="pm-state error">{t("common.loadError")}</div>;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="pm-empty">
        <Icon className="pm-icon">{PM_ICONS.check}</Icon>
        <h3>{t("partner.approvals.empty.orphansTitle")}</h3>
        <p>{t("partner.approvals.empty.orphansBody")}</p>
      </div>
    );
  }
  return (
    <>
      {items.map((o) => {
        const fullName = `${o.first_name} ${o.family_name}`.trim();
        return (
          <ApprovalRow
            key={o.id}
            iconKind="orphan"
            glyph={ageGlyph(o.first_name)}
            name={fullName}
            meta={
              <>
                <span className="pm-latin">{o.code}</span>
                <span className="pm-dot" />
                <span>{o.gender === "M" ? t("orphans.male") : t("orphans.female")}</span>
                <span className="pm-dot" />
                <span className="pm-latin">{o.date_of_birth}</span>
              </>
            }
          >
            <button
              type="button"
              className="pm-mini-btn"
              aria-label={t("orphans.actions.viewExisting", "View")}
              onClick={() => window.open(`/admin/orphans/${o.id}`, "_blank")}
            >
              <Icon>{PM_ICONS.eye}</Icon>
            </button>
            {canAct && (
              <>
                <button
                  type="button"
                  className="pm-mini-btn no"
                  aria-label={t("orphans.actions.reject")}
                  onClick={() => onReject(o.id)}
                  disabled={busy}
                >
                  <Icon>{PM_ICONS.x}</Icon>
                </button>
                <button
                  type="button"
                  className="pm-mini-btn ok"
                  aria-label={t("orphans.actions.approve")}
                  onClick={() => {
                    if (window.confirm(t("orphans.actions.approveConfirm"))) onApprove(o.id);
                  }}
                  disabled={busy}
                >
                  <Icon>{PM_ICONS.check}</Icon>
                </button>
              </>
            )}
          </ApprovalRow>
        );
      })}
    </>
  );
}

// ── Reports queue (real) ────────────────────────────────────────
function ReportsQueue({
  query,
  canAct,
  onApprove,
  onReject,
  busy,
}: {
  query: ReturnType<typeof useQuery<{ items: Report[]; total: number }>>;
  canAct: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (query.isLoading) return <div className="pm-state">{t("common.loading")}</div>;
  if (query.error) return <div className="pm-state error">{t("common.loadError")}</div>;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="pm-empty">
        <Icon className="pm-icon">{PM_ICONS.check}</Icon>
        <h3>{t("partner.approvals.empty.reportsTitle")}</h3>
        <p>{t("partner.approvals.empty.reportsBody")}</p>
      </div>
    );
  }
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(i18n.language);
  return (
    <>
      {items.map((r) => (
        <ApprovalRow
          key={r.id}
          iconKind="report"
          glyph={<Icon className="pm-icon">{PM_ICONS.file}</Icon>}
          name={t(`reports.types.${r.report_type}`, r.report_type)}
          meta={
            <>
              <span className="pm-latin">
                {fmtDate(r.period_start)} → {fmtDate(r.period_end)}
              </span>
              <span className="pm-dot" />
              <span>{t(`reports.statuses.${r.status}`, r.status)}</span>
            </>
          }
        >
          <button
            type="button"
            className="pm-mini-btn"
            aria-label={t("common.view", "View")}
            onClick={() => window.open(`/admin/reports/${r.id}`, "_blank")}
          >
            <Icon>{PM_ICONS.eye}</Icon>
          </button>
          {canAct && (
            <>
              <button
                type="button"
                className="pm-mini-btn no"
                aria-label={t("orphans.actions.reject")}
                onClick={() => onReject(r.id)}
                disabled={busy}
              >
                <Icon>{PM_ICONS.x}</Icon>
              </button>
              <button
                type="button"
                className="pm-mini-btn ok"
                aria-label={t("partner.approvals.approvePartner")}
                onClick={() => onApprove(r.id)}
                disabled={busy}
              >
                <Icon>{PM_ICONS.check}</Icon>
              </button>
            </>
          )}
        </ApprovalRow>
      ))}
    </>
  );
}

// ── Bank-transfers queue (real) ─────────────────────────────────
function BankQueue({
  query,
  canAct,
  onApprove,
  busy,
}: {
  query: ReturnType<typeof useQuery<{ items: import("@/lib/bankTransfers").BankTransfer[]; total: number }>>;
  canAct: boolean;
  onApprove: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  if (query.isLoading) return <div className="pm-state">{t("common.loading")}</div>;
  if (query.error) return <div className="pm-state error">{t("common.loadError")}</div>;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="pm-empty">
        <Icon className="pm-icon">{PM_ICONS.check}</Icon>
        <h3>{t("partner.approvals.empty.bankTitle")}</h3>
        <p>{t("partner.approvals.empty.bankBody")}</p>
      </div>
    );
  }
  return (
    <>
      {items.map((tx) => (
        <ApprovalRow
          key={tx.id}
          iconKind="bank"
          glyph={<Icon className="pm-icon">{PM_ICONS.dollar}</Icon>}
          name={
            <>
              {t("partner.approvals.bankRowTitle")}{" "}
              <span className="pm-latin">
                {tx.amount} {tx.currency}
              </span>
            </>
          }
          meta={
            <>
              <span className="pm-latin">{tx.code}</span>
              <span className="pm-dot" />
              <span className="pm-latin">
                {tx.period_start} → {tx.period_end}
              </span>
            </>
          }
          stamp={
            <span className="pm-app-stamp gold">{t("partner.approvals.awaitingApproval")}</span>
          }
        >
          {canAct && (
            <button
              type="button"
              className="pm-mini-btn gold"
              aria-label={t("bankTransfers.approve")}
              onClick={() => onApprove(tx.id)}
              disabled={busy}
            >
              <Icon>{PM_ICONS.check}</Icon>
            </button>
          )}
        </ApprovalRow>
      ))}
    </>
  );
}

// ── Media queue (stub) ──────────────────────────────────────────
// TODO(backend): no media-moderation queue endpoint
// (GET /media?moderation_status=pending) exists yet. Styled to match
// the mockup's empty state; wire up when the endpoint lands.
function MediaQueueStub() {
  const { t } = useTranslation();
  return (
    <div className="pm-empty neutral">
      <Icon className="pm-icon">{PM_ICONS.image}</Icon>
      <h3>{t("partner.approvals.empty.mediaTitle")}</h3>
      <p>{t("partner.approvals.empty.mediaBody")}</p>
    </div>
  );
}
