import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRole } from "@/hooks/useRole";
import {
  type Report,
  type ReportAction,
  type ReportStatus,
  listReports,
  transitionReport,
} from "@/lib/reports";
import { toast } from "@/store/toasts";

import "./PartnerReportsReviewPage.css";

// Workflow gating — mirrors ReportsPage exactly. partner_staff only ever
// submits drafts; partner_manager additionally approves the partner step.
// The backend enforces every restricted action; this is a UI hint only.
const PARTNER_MANAGER_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
  pending_partner_approval: "approve-partner",
};
const PARTNER_STAFF_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
};

// Left-list tabs → the report status they query.
const TABS = [
  { key: "pending", status: "pending_partner_approval" as ReportStatus },
  { key: "rejected", status: "rejected" as ReportStatus },
  { key: "approved", status: "partner_approved" as ReportStatus },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Order the report's structured sections are rendered in.
const SECTION_KEYS = [
  "educational_progress",
  "quran_progress",
  "activities",
  "health_status",
  "psychological_status",
] as const;

const STATUS_BADGE: Record<string, string> = {
  pending_partner_approval: "",
  pending_org_approval: "",
  draft: "",
  partner_approved: "ok",
  org_approved: "ok",
  published_to_donor: "ok",
  rejected: "no",
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function initial(s: string | null | undefined): string {
  return s?.trim()?.[0] ?? "—";
}

export function PartnerReportsReviewPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isPartnerApprover } = useRole();

  const NEXT_ACTION = isPartnerApprover
    ? PARTNER_MANAGER_NEXT_ACTION
    : PARTNER_STAFF_NEXT_ACTION;
  const rejectable = useMemo(
    () => new Set(Object.keys(NEXT_ACTION) as ReportStatus[]),
    [NEXT_ACTION],
  );

  const [tab, setTab] = useState<TabKey>("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const activeStatus = TABS.find((x) => x.key === tab)!.status;

  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", { status: activeStatus, limit: 50 }],
    queryFn: () => listReports({ status: activeStatus, limit: 50 }),
  });

  // Lightweight count queries so each tab can show its badge. TABS is a
  // fixed, constant-length list, so these are declared explicitly (one per
  // tab) to keep hook order stable.
  const pendingCount = useQuery({
    queryKey: ["reports", { status: "pending_partner_approval", limit: 1 }],
    queryFn: () => listReports({ status: "pending_partner_approval", limit: 1 }),
  });
  const rejectedCount = useQuery({
    queryKey: ["reports", { status: "rejected", limit: 1 }],
    queryFn: () => listReports({ status: "rejected", limit: 1 }),
  });
  const approvedCount = useQuery({
    queryKey: ["reports", { status: "partner_approved", limit: 1 }],
    queryFn: () => listReports({ status: "partner_approved", limit: 1 }),
  });
  const counts: Record<TabKey, number | undefined> = {
    pending: pendingCount.data?.total,
    rejected: rejectedCount.data?.total,
    approved: approvedCount.data?.total,
  };

  const items = useMemo(() => {
    const list = data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.orphan_id.toLowerCase().includes(q) ||
        (r.summary ?? "").toLowerCase().includes(q) ||
        t(`reports.types.${r.report_type}`, r.report_type).toLowerCase().includes(q),
    );
  }, [data, search, t]);

  // Keep a valid selection as the list changes.
  useEffect(() => {
    const first = items[0];
    if (!first) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((r) => r.id === selectedId)) {
      setSelectedId(first.id);
    }
  }, [items, selectedId]);

  // Clear the internal note whenever the selected report changes.
  useEffect(() => {
    setNote("");
  }, [selectedId]);

  const selected = items.find((r) => r.id === selectedId) ?? null;

  const mut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ReportAction }) =>
      transitionReport(id, action),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("reports.actions.success"));
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      transitionReport(id, "reject", reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("reports.actions.rejected"));
      setNote("");
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  function onReject() {
    if (!selected) return;
    const reason = note.trim();
    if (reason.length === 0) {
      toast.error(t("reports.actions.rejectReason"));
      return;
    }
    rejectMut.mutate({ id: selected.id, reason });
  }

  const nextAction = selected ? NEXT_ACTION[selected.status] : undefined;
  const canReject = selected ? rejectable.has(selected.status) : false;

  return (
    <div className="ps-reports">
      <div className="ps-reports-header">
        <h1>{t("reports.reviewTitle")}</h1>
        <p>{t("reports.reviewSubtitle")}</p>
      </div>

      <div className="ps-reports-shell">
        {/* ── Review list ───────────────────────────────────────── */}
        <aside className="ps-review-list">
          <div className="ps-list-tabs" role="tablist">
            {TABS.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                className={`ps-list-tab${tab === x.key ? " active" : ""}`}
                onClick={() => setTab(x.key)}
              >
                {t(`reports.reviewTabs.${x.key}`)}
                {counts[x.key] !== undefined && (
                  <span className="count latin">{counts[x.key]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="ps-list-filter">
            <div className="ps-list-search">
              <input
                type="search"
                placeholder={t("reports.reviewSearch")}
                aria-label={t("reports.reviewSearch")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
          </div>

          <div className="ps-list-scroll">
            {isLoading && <p className="ps-list-empty">{t("common.loading")}</p>}
            {error && <p className="ps-list-empty">{t("common.loadError")}</p>}
            {data && items.length === 0 && (
              <p className="ps-list-empty">{t("reports.emptyDesc")}</p>
            )}
            {items.map((r) => (
              <ReviewListItem
                key={r.id}
                report={r}
                lang={i18n.language}
                active={r.id === selectedId}
                onClick={() => setSelectedId(r.id)}
              />
            ))}
          </div>
        </aside>

        {/* ── Reviewer panel ────────────────────────────────────── */}
        <section className="ps-reviewer" aria-label={t("reports.reviewTitle")}>
          {!selected ? (
            <div className="ps-reviewer-empty">
              <svg className="ps-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 40, height: 40 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <div>{t("reports.reviewEmptySelection")}</div>
            </div>
          ) : (
            <Reviewer
              report={selected}
              lang={i18n.language}
              note={note}
              onNote={setNote}
              nextAction={nextAction}
              canReject={canReject}
              onNext={() => nextAction && mut.mutate({ id: selected.id, action: nextAction })}
              onReject={onReject}
              busy={mut.isPending || rejectMut.isPending}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function presentPills(report: Report): { key: string; cls: string }[] {
  const pills: { key: string; cls: string }[] = [];
  if (report.health_status) pills.push({ key: "health_status", cls: "health" });
  if (report.educational_progress) pills.push({ key: "educational_progress", cls: "edu" });
  if (report.quran_progress) pills.push({ key: "quran_progress", cls: "image" });
  return pills;
}

function ReviewListItem({
  report,
  lang,
  active,
  onClick,
}: {
  report: Report;
  lang: string;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const created = new Date(report.created_at);
  const time = Number.isNaN(created.getTime())
    ? ""
    : created.toLocaleDateString(lang, { day: "numeric", month: "short" });
  const typeLabel = t(`reports.types.${report.report_type}`, report.report_type);
  return (
    <button
      type="button"
      className={`ps-review-item${active ? " active" : ""}`}
      onClick={onClick}
    >
      <span className="ps-review-avatar" aria-hidden="true">
        {initial(typeLabel)}
      </span>
      <span>
        <span className="ps-review-item-top">
          <span className="ps-review-item-name">{typeLabel}</span>
          <span className="ps-review-item-time">{time}</span>
        </span>
        <span className="ps-review-item-sub tabular-nums">
          {report.period_start} → {report.period_end}
        </span>
        {report.summary && (
          <span className="ps-review-item-preview">{report.summary}</span>
        )}
        <span className="ps-review-item-pills">
          {presentPills(report).map((p) => (
            <span key={p.key} className={`ps-review-item-pill ${p.cls}`}>
              {t(`reports.sections.${p.key}`)}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

function Reviewer({
  report,
  lang,
  note,
  onNote,
  nextAction,
  canReject,
  onNext,
  onReject,
  busy,
}: {
  report: Report;
  lang: string;
  note: string;
  onNote: (v: string) => void;
  nextAction: ReportAction | undefined;
  canReject: boolean;
  onNext: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const typeLabel = t(`reports.types.${report.report_type}`, report.report_type);
  const statusLabel = t(`reports.statuses.${report.status}`, report.status);
  const badgeCls = STATUS_BADGE[report.status] ?? "";
  const created = new Date(report.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? ""
    : created.toLocaleString(lang);

  return (
    <>
      <header className="ps-reviewer-head">
        <div className="ps-reviewer-head-photo" aria-hidden="true">
          {initial(typeLabel)}
        </div>
        <div className="ps-reviewer-head-text">
          <div className="ps-reviewer-head-name">
            {typeLabel}
            <span className="ps-review-item-pill image">
              {report.period_start} → {report.period_end}
            </span>
          </div>
          <div className="ps-reviewer-head-meta">
            {createdLabel && <span className="tabular-nums">{createdLabel}</span>}
          </div>
        </div>
      </header>

      <div className="ps-reviewer-body">
        <h2 className="ps-report-title">{typeLabel}</h2>
        <div className="ps-report-meta">
          <span className={`ps-report-badge ${badgeCls}`}>
            <span className="dot" aria-hidden="true" />
            {statusLabel}
          </span>
          <span>{t("reports.type")}: {typeLabel}</span>
        </div>

        {report.summary && (
          <div className="ps-r-section">
            <div className="ps-r-section-title">
              <Icon>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </Icon>
              {t("reports.sections.summary")}
            </div>
            <div className="ps-r-text">{report.summary}</div>
          </div>
        )}

        {SECTION_KEYS.map((key) => {
          const value = report[key as keyof Report] as Record<string, unknown> | null;
          if (!value || Object.keys(value).length === 0) return null;
          return (
            <div key={key} className="ps-r-section">
              <div className="ps-r-section-title">
                <Icon>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                </Icon>
                {t(`reports.sections.${key}`)}
              </div>
              <div className="ps-r-rows">
                {Object.entries(value).map(([k, v]) => (
                  <div key={k} className="ps-r-row">
                    <span className="ps-r-row-label">{k}</span>
                    <span className="ps-r-row-value">
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ps-reviewer-foot">
        {nextAction || canReject ? (
          <>
            <div className="ps-reviewer-note">
              <input
                type="text"
                placeholder={t("reports.reviewNotePlaceholder")}
                aria-label={t("reports.reviewNotePlaceholder")}
                value={note}
                onChange={(e) => onNote(e.target.value)}
              />
            </div>
            <div className="ps-foot-actions">
              {canReject && (
                <button
                  type="button"
                  className="ps-foot-btn ps-foot-btn-reject"
                  onClick={onReject}
                  disabled={busy}
                >
                  <Icon>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </Icon>
                  {t("reports.actions.reject")}
                </button>
              )}
              {nextAction && (
                <button
                  type="button"
                  className="ps-foot-btn ps-foot-btn-approve"
                  onClick={onNext}
                  disabled={busy}
                >
                  <Icon>
                    <polyline points="20 6 9 17 4 12" />
                  </Icon>
                  {t(`reports.actions.${nextAction}`)}
                </button>
              )}
            </div>
          </>
        ) : (
          // partner_staff has no action on a submitted report — it is the
          // manager's to approve. Show a read-only hint instead.
          <span className="ps-foot-hint">{t("reports.reviewReadOnly")}</span>
        )}
      </div>
    </>
  );
}
