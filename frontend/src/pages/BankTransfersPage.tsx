import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmReceiptDialog } from "@/components/ConfirmReceiptDialog";
import { Money } from "@/components/Money";
import { Skeleton } from "@/components/Skeleton";
import {
  approveBankTransfer,
  type BankTransfer,
  type BankTransferCreateInput,
  cancelBankTransfer,
  createBankTransfer,
  listBankTransfers,
  markBankTransferCompleted,
  type TransferStatus,
} from "@/lib/bankTransfers";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

import "./finance.css";
import "./BankTransfersPage.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

const QK = ["bank-transfers"] as const;

type TransferSort = "oldest" | "newest" | "amountDesc";
const SORTS: TransferSort[] = ["oldest", "newest", "amountDesc"];

// Pipeline stages → which transfer statuses fall under each, and the chip
// tone used on the card. Mirrors the F-05 stage tabs.
type StageKey = "draft" | "review" | "executing" | "confirm";
const STAGE_STATUSES: Record<StageKey, TransferStatus[]> = {
  draft: ["pending"],
  review: ["approved"],
  executing: ["processing"],
  confirm: ["completed"],
};
const STATUS_CHIP: Record<TransferStatus, string> = {
  pending: "draft",
  approved: "review",
  processing: "executing",
  completed: "confirm",
  failed: "cancelled",
  cancelled: "cancelled",
};

// The four workflow-trail steps and how far each status has progressed.
const TRAIL_STEPS = ["wfDraft", "wfApproval", "wfExecute", "wfConfirm"] as const;
function trailProgress(tx: BankTransfer): number {
  if (tx.confirmed_by_partner_at) return 4;
  if (tx.status === "completed") return 3;
  if (tx.status === "processing" || tx.status === "approved") return 2;
  return 1;
}

export function BankTransfersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  // The single route hosts both F-05 (pending pipeline) and F-04 (create) via
  // explicit tabs. Pipeline is the default so the list/actions stay reachable.
  const [view, setView] = useState<"pipeline" | "create">("pipeline");
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<StageKey | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TransferSort>("oldest");

  const transfersQ = useQuery({ queryKey: QK, queryFn: () => listBankTransfers() });
  const partnersQ = useQuery({
    queryKey: ["partners", { includeInactive: false }],
    queryFn: () => listPartners(false),
  });

  function axiosMsg(err: unknown): string {
    if (err instanceof AxiosError) return err.response?.data?.detail ?? err.message;
    return (err as Error).message ?? "error";
  }

  const approveM = useMutation({
    mutationFn: (id: string) => approveBankTransfer(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.approved"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });
  const completeM = useMutation({
    mutationFn: (id: string) => markBankTransferCompleted(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.completed"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });
  const cancelM = useMutation({
    mutationFn: (id: string) => cancelBankTransfer(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK });
      toast.success(t("bankTransfers.cancelled"));
    },
    onError: (err) => toast.error(axiosMsg(err)),
  });

  const partnerName = (id: string): string => {
    const p = partnersQ.data?.items.find((p) => p.id === id);
    if (!p) return id.slice(0, 8);
    return i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar;
  };

  const items = useMemo(() => transfersQ.data?.items ?? [], [transfersQ.data]);

  // Stage aggregates (count + summed amount) from the real list.
  const stageAgg = useMemo(() => {
    const acc = {} as Record<StageKey, { count: number; total: number; currency: string | null }>;
    (Object.keys(STAGE_STATUSES) as StageKey[]).forEach((k) => {
      acc[k] = { count: 0, total: 0, currency: null };
    });
    for (const tx of items) {
      const stage = (Object.keys(STAGE_STATUSES) as StageKey[]).find((k) =>
        STAGE_STATUSES[k].includes(tx.status),
      );
      if (!stage) continue;
      acc[stage].count += 1;
      acc[stage].total += Number(tx.amount) || 0;
      acc[stage].currency ??= tx.currency;
    }
    return acc;
  }, [items]);

  // TODO(backend): server-side filtering/sorting — search, stage filter and
  // sort all run client-side over the loaded list.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((tx) => {
      if (activeStage && !STAGE_STATUSES[activeStage].includes(tx.status)) return false;
      if (!q) return true;
      return (
        tx.code.toLowerCase().includes(q) ||
        partnerName(tx.partner_organization_id).toLowerCase().includes(q) ||
        (tx.bank_reference ?? "").toLowerCase().includes(q)
      );
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "amountDesc") return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      const cmp = a.created_at.localeCompare(b.created_at);
      return sortKey === "newest" ? -cmp : cmp;
    });
    return sorted;
    // partnerName depends on partnersQ; recompute when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeStage, query, sortKey, partnersQ.data]);

  const pipelineTotal = items.reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
  const pipelineCurrency = items[0]?.currency ?? null;

  return (
    <div className="fin-page">
      <div className="fin-head">
        <div>
          <h1>{t("bankTransfers.title")}</h1>
          <p>{t("bankTransfers.subtitle")}</p>
        </div>
        <div className="fin-head-actions">
          <button
            type="button"
            className="fin-btn-primary"
            onClick={() => setView(view === "create" ? "pipeline" : "create")}
          >
            <FinIcon>{FIN_ICONS.plus}</FinIcon>
            {view === "create" ? t("common.cancel") : t("bankTransfers.addNew")}
          </button>
        </div>
      </div>

      {/* ── F-04 / F-05 split — explicit tabs on the one route ───────── */}
      <nav className="fin-bt-tabs" aria-label={t("bankTransfers.title")}>
        <button
          type="button"
          className={view === "pipeline" ? "active" : ""}
          aria-pressed={view === "pipeline"}
          onClick={() => setView("pipeline")}
        >
          <FinIcon>{FIN_ICONS.clock}</FinIcon>
          {t("bankTransfers.tabPipeline")}
        </button>
        <button
          type="button"
          className={view === "create" ? "active" : ""}
          aria-pressed={view === "create"}
          onClick={() => setView("create")}
        >
          <FinIcon>{FIN_ICONS.plus}</FinIcon>
          {t("bankTransfers.tabCreate")}
        </button>
      </nav>

      {view === "create" ? (
        partnersQ.data ? (
          <NewTransferForm
            partners={partnersQ.data.items}
            onCreated={async () => {
              await qc.invalidateQueries({ queryKey: QK });
              setView("pipeline");
            }}
            onCancel={() => setView("pipeline")}
          />
        ) : (
          <Skeleton className="h-64 w-full" />
        )
      ) : (
        <>
      {/* ── Pipeline header ────────────────────────────────────────── */}
      <section className="fin-wf-bar">
        <div className="ic">
          <FinIcon className="fin-icon">{FIN_ICONS.clock}</FinIcon>
        </div>
        <div className="text">
          <div className="ttl">
            {t("bankTransfers.pipelineTitle")} · {t("bankTransfers.stageCount", { count: items.length })}
          </div>
          <div className="ds">{t("bankTransfers.pipelineDesc")}</div>
        </div>
        <div className="total">
          <div className="lab">{t("bankTransfers.pipelineTotal")}</div>
          <div className="v">
            <Money amount={pipelineTotal} currency={pipelineCurrency} />
          </div>
        </div>
      </section>

      {/* ── Stage tiles (filter) ───────────────────────────────────── */}
      <section className="fin-stages" aria-label={t("bankTransfers.status")}>
        {(Object.keys(STAGE_STATUSES) as StageKey[]).map((stage, i) => (
          <button
            key={stage}
            type="button"
            className={`fin-stage s${i + 1}${activeStage === stage ? " active" : ""}`}
            aria-pressed={activeStage === stage}
            onClick={() => setActiveStage((cur) => (cur === stage ? null : stage))}
          >
            <div className="fin-stage-h">
              <span className="si">
                <FinIcon>{STAGE_ICON[stage]}</FinIcon>
              </span>
              <span className="lab">{t(`bankTransfers.${STAGE_LABEL[stage]}`)}</span>
            </div>
            <div className="count">{stageAgg[stage].count.toLocaleString(i18n.language)}</div>
            <div className="v">
              <strong>
                <Money amount={stageAgg[stage].total} currency={stageAgg[stage].currency} />
              </strong>
            </div>
          </button>
        ))}
      </section>

      {/* ── Search + sort ──────────────────────────────────────────── */}
      <section className="fin-filter-bar">
        <div className="fin-search">
          <FinIcon>{FIN_ICONS.search}</FinIcon>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("bankTransfers.searchPlaceholder")}
            aria-label={t("bankTransfers.searchPlaceholder")}
          />
        </div>
        <label className="fin-fpill">
          <span className="sr-only">{t("bankTransfers.sortBy")}</span>
          <FinIcon>{FIN_ICONS.bars}</FinIcon>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as TransferSort)} aria-label={t("bankTransfers.sortBy")}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`bankTransfers.sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      {transfersQ.isLoading && <Skeleton className="h-40 w-full" />}
      {transfersQ.error && <p className="fin-error">{t("common.loadError")}</p>}

      {confirmTarget && (
        <ConfirmReceiptDialog
          transferId={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onConfirmed={async () => {
            await qc.invalidateQueries({ queryKey: QK });
            toast.success(t("bankTransfers.confirmed"));
          }}
        />
      )}

      {transfersQ.data && filtered.length === 0 && (
        <div className="fin-tbl-card">
          <div className="fin-empty">
            <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
            <div className="fin-empty-title">
              {items.length === 0 ? t("common.empty") : t("bankTransfers.noneInStage")}
            </div>
          </div>
        </div>
      )}

      {filtered.length > 0 && (
        <section className="fin-tr-list">
          {filtered.map((tx) => (
            <TransferCard
              key={tx.id}
              tx={tx}
              partnerName={partnerName(tx.partner_organization_id)}
              onApprove={() => approveM.mutate(tx.id)}
              onComplete={() => completeM.mutate(tx.id)}
              onConfirm={() => setConfirmTarget(tx.id)}
              onCancel={() => cancelM.mutate(tx.id)}
              busy={approveM.isPending || completeM.isPending || cancelM.isPending}
            />
          ))}
        </section>
      )}
        </>
      )}
    </div>
  );
}

const STAGE_LABEL: Record<StageKey, string> = {
  draft: "stageDraft",
  review: "stagePendingApproval",
  executing: "stageExecuting",
  confirm: "stageAwaitingConfirm",
};
const STAGE_ICON: Record<StageKey, ReactNode> = {
  draft: FIN_ICONS.fileText,
  review: FIN_ICONS.checkSquare,
  executing: FIN_ICONS.exchange,
  confirm: FIN_ICONS.clock,
};

function TransferCard({
  tx,
  partnerName,
  onApprove,
  onComplete,
  onConfirm,
  onCancel,
  busy,
}: {
  tx: BankTransfer;
  partnerName: string;
  onApprove: () => void;
  onComplete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const progress = trailProgress(tx);
  const canCancel = ["pending", "approved", "processing"].includes(tx.status);

  return (
    <article className="fin-tr-card">
      <header className="fin-tr-head">
        <div className="p-logo">{partnerName.slice(0, 1)}</div>
        <div className="fin-tr-head-info">
          <div className="nm">{partnerName}</div>
          <div className="meta">
            <span className="id">{tx.code}</span>
            <span className="dot">·</span>
            <span className="fin-latin">
              {tx.period_start} → {tx.period_end}
            </span>
          </div>
        </div>
        <div className="fin-tr-head-amt">
          <div className="v">
            <Money amount={tx.amount} currency={tx.currency} />
          </div>
        </div>
        <span className={`fin-stage-chip ${STATUS_CHIP[tx.status]}`}>
          {t(`bankTransfers.statuses.${tx.status}`, tx.status)}
        </span>
      </header>
      <div className="fin-tr-body">
        <div className="fin-tr-meta-grid">
          <Meta label={t("bankTransfers.metaReference")} value={tx.bank_reference ?? "—"} mono />
          <Meta label={t("bankTransfers.metaBank")} value={tx.bank_name ?? "—"} />
          <Meta label={t("bankTransfers.period")} value={`${tx.period_start}`} />
          <Meta label={t("bankTransfers.metaCreated")} value={tx.created_at.slice(0, 10)} />
        </div>

        {/* Workflow trail */}
        <div className="fin-wf-trail">
          {TRAIL_STEPS.map((step, i) => {
            const state = i < progress ? "done" : i === progress ? "active" : "pending";
            return (
              <div key={step} style={{ display: "contents" }}>
                {i > 0 && <span className={`fin-wf-line${i < progress ? " done" : ""}`} />}
                <div className={`fin-wf-step ${state}`}>
                  <span className="dot">
                    {state === "done" ? (
                      <FinIcon>{FIN_ICONS.check}</FinIcon>
                    ) : state === "pending" ? (
                      <FinIcon>
                        <circle cx="12" cy="12" r="10" />
                      </FinIcon>
                    ) : null}
                  </span>
                  <div className="lab">
                    <span className="l1">{t(`bankTransfers.${step}`)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions — primary labels preserved for the bank-transfer E2E. */}
        <div className="fin-tr-actions">
          <div className="sec">
            {/* TODO(backend): no details view / PDF export endpoint yet. */}
            <button
              type="button"
              className="fin-action secondary"
              onClick={() => toast.info(t("common.comingSoon"))}
            >
              <FinIcon>{FIN_ICONS.fileText}</FinIcon>
              {t("bankTransfers.viewDetails")}
            </button>
            <button
              type="button"
              className="fin-action secondary"
              onClick={() => toast.info(t("common.comingSoon"))}
            >
              <FinIcon>{FIN_ICONS.download}</FinIcon>
              {t("bankTransfers.viewPdf")}
            </button>
            {canCancel && (
              <button type="button" className="fin-action danger" onClick={onCancel} disabled={busy}>
                <FinIcon>{FIN_ICONS.x}</FinIcon>
                {t("bankTransfers.cancel")}
              </button>
            )}
          </div>
          <div className="sec">
            {tx.status === "pending" && (
              <button type="button" className="fin-action primary" onClick={onApprove} disabled={busy}>
                <FinIcon>{FIN_ICONS.check}</FinIcon>
                {t("bankTransfers.approve")}
              </button>
            )}
            {(tx.status === "approved" || tx.status === "processing") && (
              <button type="button" className="fin-action primary" onClick={onComplete} disabled={busy}>
                <FinIcon>{FIN_ICONS.check}</FinIcon>
                {t("bankTransfers.markCompleted")}
              </button>
            )}
            {tx.status === "completed" && !tx.confirmed_by_partner_at && (
              <button type="button" className="fin-action primary" onClick={onConfirm}>
                <FinIcon>{FIN_ICONS.check}</FinIcon>
                {t("bankTransfers.confirmReceipt")}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="fin-tr-meta">
      <div className="ml">{label}</div>
      <div className={`mv${mono ? " fin-mono" : ""}`}>{value}</div>
    </div>
  );
}

function NewTransferForm({
  partners,
  onCreated,
  onCancel,
}: {
  partners: { id: string; name_ar: string; name_en: string | null }[];
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const empty: BankTransferCreateInput = {
    partner_organization_id: partners[0]?.id ?? "",
    amount: "",
    currency: "KWD",
    period_start: "",
    period_end: "",
    bank_name: "",
    bank_reference: "",
    notes: "",
  };
  const [v, setV] = useState<BankTransferCreateInput>(empty);
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createBankTransfer(v),
    onSuccess: () => {
      setV(empty);
      onCreated();
    },
    onError: (err) => {
      setServerError(
        err instanceof AxiosError
          ? err.response?.data?.detail ?? t("common.createError")
          : t("common.createError"),
      );
    },
  });

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const setMonth = (offset: number) => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    setV((prev) => ({ ...prev, period_start: iso(first), period_end: iso(last) }));
  };
  const setQuarter = () => {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3);
    setV((prev) => ({
      ...prev,
      period_start: iso(new Date(now.getFullYear(), q * 3, 1)),
      period_end: iso(new Date(now.getFullYear(), q * 3 + 3, 0)),
    }));
  };

  const partnerLabel = (() => {
    const p = partners.find((p) => p.id === v.partner_organization_id);
    if (!p) return "—";
    return i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar;
  })();

  return (
    <div className="fin-bt-create">
    <form
      className="fin-card"
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        if (!v.partner_organization_id || !v.amount || !v.period_start || !v.period_end) return;
        mut.mutate();
      }}
    >
      <header className="fin-card-head">
        <div>
          <h3>
            <FinIcon>{FIN_ICONS.bank}</FinIcon>
            {t("bankTransfers.createTitle")}
          </h3>
          <p>{t("bankTransfers.createDesc")}</p>
        </div>
      </header>
      <div className="fin-card-body">
        <div className="fin-form-grid">
          <label className="fin-field">
            <span className="fin-field-label">{t("bankTransfers.partner")}</span>
            <select
              className="fin-input"
              value={v.partner_organization_id}
              onChange={(e) => setV({ ...v, partner_organization_id: e.target.value })}
            >
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar}
                </option>
              ))}
            </select>
          </label>
          <label className="fin-field">
            <span className="fin-field-label">{t("bankTransfers.amount")}</span>
            <input
              className="fin-input"
              inputMode="decimal"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
            />
          </label>
          <label className="fin-field">
            <span className="fin-field-label">{t("bankTransfers.currency")}</span>
            <input
              className="fin-input"
              maxLength={3}
              value={v.currency}
              onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="fin-field">
            <span className="fin-field-label">{t("bankTransfers.periodStart")}</span>
            <input
              type="date"
              className="fin-input"
              value={v.period_start}
              onChange={(e) => setV({ ...v, period_start: e.target.value })}
            />
          </label>
          <label className="fin-field">
            <span className="fin-field-label">{t("bankTransfers.periodEnd")}</span>
            <input
              type="date"
              className="fin-input"
              value={v.period_end}
              onChange={(e) => setV({ ...v, period_end: e.target.value })}
            />
          </label>
          <label className="fin-field">
            <span className="fin-field-label">{t("bankTransfers.bankName")}</span>
            <input
              className="fin-input"
              value={v.bank_name ?? ""}
              onChange={(e) => setV({ ...v, bank_name: e.target.value })}
            />
          </label>
        </div>

        {/* Period quick-set buttons fill the date inputs above. */}
        <div className="fin-bt-quick" role="group" aria-label={t("bankTransfers.period")}>
          <button type="button" onClick={() => setMonth(-1)}>
            {t("bankTransfers.quickPrevMonth")}
          </button>
          <button type="button" onClick={() => setMonth(0)}>
            {t("bankTransfers.quickThisMonth")}
          </button>
          <button type="button" onClick={setQuarter}>
            {t("bankTransfers.quickQuarter")}
          </button>
        </div>

        <label className="fin-field" style={{ marginTop: 14 }}>
          <span className="fin-field-label">{t("bankTransfers.notes")}</span>
          <textarea
            className="fin-input"
            value={v.notes ?? ""}
            onChange={(e) => setV({ ...v, notes: e.target.value })}
            placeholder={t("bankTransfers.notesPlaceholder")}
          />
        </label>

        {/* TODO(backend): no live FX endpoint — banner renders with a
            placeholder rate, never a fabricated number. */}
        <div className="fin-bt-fxbanner" role="note">
          <FinIcon>{FIN_ICONS.info}</FinIcon>
          <span>{t("bankTransfers.fxBanner")}</span>
          <span className="rate fin-ph">—</span>
        </div>

        <p className="fin-card-note">{t("bankTransfers.createItemizedNote")}</p>
        {serverError && (
          <p className="fin-error" style={{ marginTop: 12 }}>
            {serverError}
          </p>
        )}
        <div className="fin-bt-formfoot">
          <button type="button" className="fin-btn-secondary" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="fin-btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </form>

    {/* Right summary rail — running totals from the form's own fields. */}
    <aside className="fin-bt-rail">
      <div className="fin-bt-rail-card">
        <div className="sm-h">{t("bankTransfers.railTotal")}</div>
        <div className="sm-big">
          {v.amount ? (
            <Money amount={v.amount || "0"} currency={v.currency || "KWD"} />
          ) : (
            <span className="fin-ph">—</span>
          )}
        </div>

        <div className="sm-divider" />

        <div className="sm-h">{t("bankTransfers.railSummary")}</div>
        <div className="sm-list">
          <div className="sm-row">
            <span className="k">{t("bankTransfers.partner")}</span>
            <span className="v">{partnerLabel}</span>
          </div>
          <div className="sm-row">
            <span className="k">{t("bankTransfers.period")}</span>
            <span className="v fin-latin">
              {v.period_start && v.period_end ? `${v.period_start} → ${v.period_end}` : "—"}
            </span>
          </div>
          <div className="sm-row">
            <span className="k">{t("bankTransfers.bankName")}</span>
            <span className="v">{v.bank_name || "—"}</span>
          </div>
          {/* TODO(backend): orphan/sponsor counts & bank fees aren't on the
              create payload — omitted rather than shown as fake figures. */}
        </div>

        <div className="fin-bt-approval" role="note">
          <FinIcon>{FIN_ICONS.info}</FinIcon>
          <span>{t("bankTransfers.railApprovalNote")}</span>
        </div>
      </div>
    </aside>
    </div>
  );
}
