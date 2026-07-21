/**
 * OA-08 Reports Center
 * Ported 1:1 from the mockup (OA-08 Reports Center.html).
 * RTL-first, Arabic/English, scoped under .oa-reports.
 *
 * Live data wiring:
 *   GET /reports?report_type= → { reports, total } via listReports()
 *
 * Sections without a backend source (template cards, scheduled reports,
 * recent exports, builder modal, download counts, file sizes) render
 * "—" or inert UI and are annotated with TODO(backend).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type React from "react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { PartnerReportsReviewPage } from "./PartnerReportsReviewPage";
import {
  downloadLatePayersReport,
  listReports,
  transitionReport,
  type ReportAction,
  type ReportStatus,
} from "@/lib/reports";
import { toast } from "@/store/toasts";

import "./ReportsPage.css";

// ── Inline icon set ──────────────────────────────────────────────
function Icon({
  children,
  className = "oa-r-icon",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  bars: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
    </>
  ),
  building: <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />,
  pulse: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  cross: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  play: <polygon points="5 3 19 12 5 21 5 3" />,
  xCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
  chevronStart: <polyline points="15 18 9 12 15 6" />,
  calRect: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
    </>
  ),
  sparkle: (
    <path d="M12 2v6m0 8v6M2 12h6m8 0h6M5 5l4 4m6 6l4 4M5 19l4-4m6-6l4-4" />
  ),
  sparkleD: "M12 2v6m0 8v6M2 12h6m8 0h6M5 5l4 4m6 6l4 4M5 19l4-4m6-6l4-4",
};

// ── Workflow map (identical logic from original) ──────────────────
const ADMIN_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
  pending_partner_approval: "approve-partner",
  pending_org_approval: "approve-org",
  org_approved: "publish",
};
const PARTNER_MANAGER_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
  pending_partner_approval: "approve-partner",
};
const PARTNER_STAFF_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
};

function rejectableStatuses(
  map: Partial<Record<ReportStatus, ReportAction>>,
): Set<ReportStatus> {
  return new Set(Object.keys(map) as ReportStatus[]);
}

// ── Type filter options (from spec) ──────────────────────────────
const TYPE_FILTERS = ["", "monthly", "quarterly", "annual", "financial"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

// ── Type/status CSS class helper ─────────────────────────────────
function typeBadgeClass(t: string): string {
  if (t === "monthly") return "monthly";
  if (t === "quarterly") return "quarterly";
  if (t === "annual") return "annual";
  if (t === "financial") return "financial";
  return "default";
}

// ════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════
export function ReportsPage() {
  // Partner roles get the PS-05 master-detail reports-review queue; admins
  // and other staff keep the OA-08 Reports Center below. Mirrors the
  // role-split used for the dashboard (DashboardHome).
  const { isAdmin, isPartner } = useRole();
  if (isPartner && !isAdmin) return <PartnerReportsReviewPage />;
  return <ReportsCenterPage />;
}

function ReportsCenterPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin, isPartnerApprover, isPartnerStaff } = useRole();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [lateExport, setLateExport] = useState<"pdf" | "xlsx" | null>(null);

  async function onLateExport(format: "pdf" | "xlsx") {
    setLateExport(format);
    try {
      const blob = await downloadLatePayersReport(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `late-payers-report-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("reports.exportError"));
    } finally {
      setLateExport(null);
    }
  }

  const NEXT_ACTION = useMemo<Partial<Record<ReportStatus, ReportAction>>>(() => {
    if (isAdmin) return ADMIN_NEXT_ACTION;
    if (isPartnerApprover) return PARTNER_MANAGER_NEXT_ACTION;
    if (isPartnerStaff) return PARTNER_STAFF_NEXT_ACTION;
    return {};
  }, [isAdmin, isPartnerApprover, isPartnerStaff]);

  const rejectable = useMemo(() => rejectableStatuses(NEXT_ACTION), [NEXT_ACTION]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", { report_type: typeFilter, limit: 50 }],
    queryFn: () => {
      // listReports accepts arbitrary params via { params } in the API call.
      // report_type is passed as a query param per the OA-08 spec.
      const params: Parameters<typeof listReports>[0] = { limit: 50 };
      if (typeFilter) {
        // The listReports signature only exposes status/orphan_id/offset; we
        // cast here so the backend receives report_type as a query string.
        (params as Record<string, unknown>).report_type = typeFilter;
      }
      return listReports(params);
    },
  });

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
      setRejectingId(null);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  return (
    <div className="oa-reports">
      {/* Single semantic h1 — sr-only because the visible label is h2 in builder */}
      <h1 className="sr-only">{t("reports.centerTitle")}</h1>

      {/* ── Hero builder banner ─────────────────────────────────── */}
      <section className="oa-reports-builder" aria-label={t("reports.builderAriaLabel")}>
        <div className="oa-reports-builder-row">
          <div className="oa-reports-builder-icon" aria-hidden="true">
            <Icon><path d={ICONS.sparkleD} /></Icon>
          </div>
          <div className="oa-reports-builder-text">
            <h2>{t("reports.builderTitle")}</h2>
            <p>{t("reports.builderDesc")}</p>
          </div>
          {/* TODO(backend): report builder (drag-and-drop, templates modal)
              has no backend endpoint yet. Buttons are inert placeholders. */}
          <div className="oa-reports-builder-actions">
            <button
              type="button"
              className="oa-reports-btn-on-dark-ghost"
              disabled
              aria-label={t("reports.myTemplates")}
            >
              <Icon className="oa-r-icon oa-r-icon-sm"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></Icon>
              {t("reports.myTemplates")}
            </button>
            <button
              type="button"
              className="oa-reports-btn-on-dark"
              disabled
              aria-label={t("reports.startReport")}
            >
              <Icon className="oa-r-icon oa-r-icon-sm">
                {ICONS.plus}
              </Icon>
              {t("reports.startReport")}
            </button>
          </div>
        </div>
      </section>

      {/* ── Season templates ────────────────────────────────────── */}
      {/* TODO(backend): template library (Ramadan report, Zakat report,
          and all other ready-templates below) has no backend source.
          Generate-PDF/Excel buttons are inert. */}
      <div className="oa-reports-section-h">
        <div className="ttl">
          <Icon>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </Icon>
          {t("reports.seasonTemplates")}
          <span className="count-pill latin">2</span>
        </div>
        <span className="desc">{t("reports.seasonTemplatesDesc")}</span>
      </div>

      <div className="oa-reports-tmpl-grid">
        {/* Ramadan report — featured */}
        <article className="oa-reports-tmpl-card featured ramadan">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon ramadan" aria-hidden="true">
              <Icon>
                {ICONS.moon}
              </Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">
                {t("reports.tmpl.ramadan.name")}
                <span className="oa-reports-featured-flag">
                  <Icon>
                    {ICONS.star}
                  </Icon>
                  {t("reports.tmpl.thisMonth")}
                </span>
              </div>
              <div className="ds">{t("reports.tmpl.ramadan.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields" aria-label={t("reports.tmpl.fields")}>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.ramadan.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.ramadan.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.ramadan.f3")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.ramadan.f4")}</span>
            <span className="oa-reports-tmpl-field">
              +<span className="latin">4</span>
            </span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                </svg>
                <span className="latin">1 - 30</span> {t("reports.tmpl.ramadan.period")}
              </span>
            </div>
            <div className="btns">
              {/* TODO(backend): PDF/Excel generation has no endpoint. */}
              <button type="button" className="oa-reports-pdf-btn" disabled aria-label={t("reports.exportPdf")}>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled aria-label={t("reports.exportExcel")}>Excel</button>
            </div>
          </div>
        </article>

        {/* Zakat report */}
        <article className="oa-reports-tmpl-card zakat">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon zakat" aria-hidden="true">
              <Icon>{ICONS.dollar}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.zakat.name")}</div>
              <div className="ds">{t("reports.tmpl.zakat.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields" aria-label={t("reports.tmpl.fields")}>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.zakat.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.zakat.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.zakat.f3")}</span>
            <span className="oa-reports-tmpl-field">
              +<span className="latin">3</span>
            </span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                </svg>
                {t("reports.cadence.annual")}
              </span>
            </div>
            <div className="btns">
              {/* TODO(backend): PDF/Excel generation has no endpoint. */}
              <button type="button" className="oa-reports-pdf-btn" disabled aria-label={t("reports.exportPdf")}>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled aria-label={t("reports.exportExcel")}>Excel</button>
            </div>
          </div>
        </article>
      </div>

      {/* ── Ready templates ─────────────────────────────────────── */}
      <div className="oa-reports-section-h">
        <div className="ttl">
          <Icon>
            {ICONS.file}
          </Icon>
          {t("reports.readyTemplates")}
          <span className="count-pill latin">6</span>
        </div>
        <span className="desc">{t("reports.readyTemplatesDesc")}</span>
      </div>

      {/* TODO(backend): 5 of the 6 ready-templates are inert (no backend
          source) — their PDF/Excel buttons stay disabled and last-run times
          are mockup data. The late-payers card is live
          (GET /reports/late-payers?format=pdf|xlsx). */}
      <div className="oa-reports-tmpl-grid">
        {/* Donors annual */}
        <article className="oa-reports-tmpl-card donor">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon donor" aria-hidden="true">
              <Icon>{ICONS.heart}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.donors.name")}</div>
              <div className="ds">{t("reports.tmpl.donors.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields">
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.donors.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.donors.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.donors.f3")}</span>
            <span className="oa-reports-tmpl-field">+<span className="latin">5</span></span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11, flexShrink: 0 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {t("reports.tmpl.lastRun", { days: 7 })}
              </span>
            </div>
            <div className="btns">
              <button type="button" className="oa-reports-pdf-btn" disabled>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled>Excel</button>
            </div>
          </div>
        </article>

        {/* Orphans annual */}
        <article className="oa-reports-tmpl-card orphan">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon orphan" aria-hidden="true">
              <Icon>{ICONS.user}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.orphans.name")}</div>
              <div className="ds">{t("reports.tmpl.orphans.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields">
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.orphans.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.orphans.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.orphans.f3")}</span>
            <span className="oa-reports-tmpl-field">+<span className="latin">4</span></span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                </svg>
                {t("reports.cadence.annual")}
              </span>
            </div>
            <div className="btns">
              <button type="button" className="oa-reports-pdf-btn" disabled>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled>Excel</button>
            </div>
          </div>
        </article>

        {/* Financial performance */}
        <article className="oa-reports-tmpl-card finance">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon finance" aria-hidden="true">
              <Icon>{ICONS.bars}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.finance.name")}</div>
              <div className="ds">{t("reports.tmpl.finance.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields">
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.finance.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.finance.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.finance.f3")}</span>
            <span className="oa-reports-tmpl-field">+<span className="latin">6</span></span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                </svg>
                {t("reports.cadence.quarterly")}
              </span>
            </div>
            <div className="btns">
              <button type="button" className="oa-reports-pdf-btn" disabled>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled>Excel</button>
            </div>
          </div>
        </article>

        {/* Partners performance */}
        <article className="oa-reports-tmpl-card partner">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon partner" aria-hidden="true">
              <Icon>{ICONS.building}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.partners.name")}</div>
              <div className="ds">{t("reports.tmpl.partners.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields">
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.partners.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.partners.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.partners.f3")}</span>
            <span className="oa-reports-tmpl-field">+<span className="latin">3</span></span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                </svg>
                {t("reports.cadence.monthly")}
              </span>
            </div>
            <div className="btns">
              <button type="button" className="oa-reports-pdf-btn" disabled>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled>Excel</button>
            </div>
          </div>
        </article>

        {/* Marketing channels */}
        <article className="oa-reports-tmpl-card marketing">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon marketing" aria-hidden="true">
              <Icon>{ICONS.pulse}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.marketing.name")}</div>
              <div className="ds">{t("reports.tmpl.marketing.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields">
            <span className="oa-reports-tmpl-field">CPA</span>
            <span className="oa-reports-tmpl-field">LTV</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.marketing.f3")}</span>
            <span className="oa-reports-tmpl-field">+<span className="latin">5</span></span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                </svg>
                {t("reports.cadence.weekly")}
              </span>
            </div>
            <div className="btns">
              <button type="button" className="oa-reports-pdf-btn" disabled>PDF</button>
              <button type="button" className="oa-reports-xls-btn" disabled>Excel</button>
            </div>
          </div>
        </article>

        {/* Late payers — live export via GET /reports/late-payers */}
        <article className="oa-reports-tmpl-card donor">
          <span className="oa-reports-tmpl-accent" aria-hidden="true" />
          <div className="oa-reports-tmpl-head">
            <div className="oa-reports-tmpl-icon donor" aria-hidden="true">
              <Icon>{ICONS.cross}</Icon>
            </div>
            <div className="oa-reports-tmpl-info">
              <div className="nm">{t("reports.tmpl.late.name")}</div>
              <div className="ds">{t("reports.tmpl.late.desc")}</div>
            </div>
          </div>
          <div className="oa-reports-tmpl-fields">
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.late.f1")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.late.f2")}</span>
            <span className="oa-reports-tmpl-field">{t("reports.tmpl.late.f3")}</span>
          </div>
          <div className="oa-reports-tmpl-foot">
            <div className="meta">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }} aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                </svg>
                {t("reports.cadence.monthly")}
              </span>
            </div>
            <div className="btns">
              <button
                type="button"
                className="oa-reports-pdf-btn"
                onClick={() => void onLateExport("pdf")}
                disabled={lateExport !== null}
                aria-busy={lateExport === "pdf"}
                aria-label={t("reports.exportPdf")}
              >
                {lateExport === "pdf" ? t("reports.exporting") : "PDF"}
              </button>
              <button
                type="button"
                className="oa-reports-xls-btn"
                onClick={() => void onLateExport("xlsx")}
                disabled={lateExport !== null}
                aria-busy={lateExport === "xlsx"}
                aria-label={t("reports.exportExcel")}
              >
                {lateExport === "xlsx" ? t("reports.exporting") : "Excel"}
              </button>
            </div>
          </div>
        </article>
      </div>

      {/* ════════════════════════════════════════════════════════════
          LIVE REPORTS  (from GET /reports)
          ════════════════════════════════════════════════════════════ */}
      <div className="oa-reports-section-h">
        <div className="ttl">
          <Icon>{ICONS.file}</Icon>
          {t("reports.allReports")}
          {data && (
            <span className="count-pill latin">
              {data.total.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className="oa-reports-tbl-card">
        {/* Type filter toolbar */}
        <div className="oa-reports-tbl-toolbar" role="group" aria-label={t("reports.filterByType")}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f || "all"}
              type="button"
              className={`oa-reports-filter-btn${typeFilter === f ? " active" : ""}`}
              onClick={() => setTypeFilter(f)}
              aria-pressed={typeFilter === f}
            >
              {f ? t(`reports.types.${f}`, f) : t("reports.filterAll")}
            </button>
          ))}
        </div>

        {error && (
          <div className="oa-reports-error" role="alert">
            {t("common.loadError")}
          </div>
        )}

        {isLoading && (
          <div style={{ padding: "16px" }}>
            <TableSkeleton columns={5} />
          </div>
        )}

        {!isLoading && data && data.items.length === 0 && (
          <div className="oa-reports-empty" role="status">
            <Icon>{ICONS.file}</Icon>
            <div className="oa-reports-empty-title">{t("common.empty")}</div>
            <div className="oa-reports-empty-sub">{t("reports.emptyDesc")}</div>
          </div>
        )}

        {!isLoading && data && data.items.length > 0 && (
          <div className="oa-reports-tbl-wrap">
            <table className="oa-reports-tbl" aria-label={t("reports.allReports")}>
              <thead>
                <tr>
                  <th scope="col">{t("reports.colReport")}</th>
                  <th scope="col">{t("reports.type")}</th>
                  <th scope="col">{t("reports.period")}</th>
                  <th scope="col">{t("reports.status")}</th>
                  <th scope="col" style={{ textAlign: "end", paddingInlineEnd: 22 }}>
                    {/* actions column — no header text */}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => {
                  const nextAction = NEXT_ACTION[r.status];
                  const canReject = rejectable.has(r.status);
                  const periodStr = `${r.period_start} → ${r.period_end}`;
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="oa-reports-row-name">
                          <div className="oa-reports-row-icon" aria-hidden="true">
                            <Icon className="oa-r-icon oa-r-icon-sm">{ICONS.file}</Icon>
                          </div>
                          <div className="oa-reports-row-info">
                            <div className="nm">
                              {t(`reports.types.${r.report_type}`, r.report_type)}
                            </div>
                            <div className="sub latin" dir="ltr">{r.id.slice(0, 8)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`oa-reports-type-badge ${typeBadgeClass(r.report_type)}`}
                        >
                          {t(`reports.types.${r.report_type}`, r.report_type)}
                        </span>
                      </td>
                      <td className="latin" dir="ltr" style={{ fontFeatureSettings: '"tnum" 1' }}>
                        {periodStr}
                      </td>
                      <td>
                        <span
                          className={`oa-reports-status-badge ${r.status}`}
                        >
                          {t(`reports.statuses.${r.status}`, r.status)}
                        </span>
                      </td>
                      <td>
                        <div className="oa-reports-tbl-actions">
                          <Link
                            to={`/admin/reports/${r.id}`}
                            className="oa-reports-open-link"
                            aria-label={`${t("reports.open")} — ${r.id.slice(0, 8)}`}
                          >
                            <Icon className="oa-r-icon oa-r-icon-sm">
                              {ICONS.chevronStart}
                            </Icon>
                            {t("reports.open")}
                          </Link>
                          {nextAction && (
                            <button
                              type="button"
                              className="oa-reports-action-btn primary"
                              aria-label={t(`reports.actions.${nextAction}`, nextAction)}
                              onClick={() => mut.mutate({ id: r.id, action: nextAction })}
                              disabled={mut.isPending}
                            >
                              {t(`reports.actions.${nextAction}`, nextAction)}
                            </button>
                          )}
                          {canReject && (
                            <button
                              type="button"
                              className="oa-reports-action-btn danger"
                              aria-label={t("reports.actions.reject")}
                              onClick={() => setRejectingId(r.id)}
                              disabled={rejectMut.isPending}
                            >
                              {t("reports.actions.reject")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
          SCHEDULED REPORTS
          TODO(backend): scheduled-reports CRUD has no endpoint yet.
          The 5 rows below are static mockup data rendered inert.
          ════════════════════════════════════════════════════════════ */}
      <div className="oa-reports-section-h">
        <div className="ttl">
          <Icon>{ICONS.clock}</Icon>
          {t("reports.scheduledReports")}
          {/* TODO(backend): count from API; showing mockup count */}
          <span className="count-pill latin">—</span>
        </div>
        <button
          type="button"
          className="oa-reports-btn-ghost"
          disabled
          aria-label={t("reports.addSchedule")}
        >
          <Icon className="oa-r-icon oa-r-icon-sm">{ICONS.plus}</Icon>
          {t("reports.addSchedule")}
        </button>
      </div>

      {/* TODO(backend): scheduled reports list — no backend source. Render "—" placeholder. */}
      <section className="oa-reports-sched-card" aria-label={t("reports.scheduledReports")}>
        <div className="oa-reports-sched-wrap">
          <table className="oa-reports-sched">
            <thead>
              <tr>
                <th scope="col">{t("reports.colReport")}</th>
                <th scope="col">{t("reports.colCadence")}</th>
                <th scope="col">{t("reports.colRecipients")}</th>
                <th scope="col">{t("reports.colNextRun")}</th>
                <th scope="col">{t("reports.colLastRun")}</th>
                <th scope="col" style={{ textAlign: "end", paddingInlineEnd: 22 }} />
              </tr>
            </thead>
            <tbody>
              <ScheduledRow
                name={t("reports.sched.finance.name")}
                sub={t("reports.sched.finance.sub")}
                cadenceLabel={t("reports.sched.finance.cadence")}
                cadenceColor="info"
                recipientCount="—"
                nextRun="—"
                nextRunSub="—"
                lastRun="—"
                lastRunOk="—"
                iconType="finance"
              />
              <ScheduledRow
                name={t("reports.sched.partners.name")}
                sub={t("reports.sched.partners.sub")}
                cadenceLabel={t("reports.sched.partners.cadence")}
                cadenceColor="purple"
                recipientCount="—"
                nextRun="—"
                nextRunSub="—"
                lastRun="—"
                lastRunOk="—"
                iconType="partner"
              />
              <ScheduledRow
                name={t("reports.sched.marketing.name")}
                sub={t("reports.sched.marketing.sub")}
                cadenceLabel={t("reports.sched.marketing.cadence")}
                cadenceColor="rose"
                recipientCount="—"
                nextRun="—"
                nextRunSub="—"
                lastRun="—"
                lastRunOk="—"
                iconType="marketing"
              />
              <ScheduledRow
                name={t("reports.sched.zakat.name")}
                sub={t("reports.sched.zakat.sub")}
                cadenceLabel={t("reports.sched.zakat.cadence")}
                cadenceColor="success"
                recipientCount="—"
                nextRun="—"
                nextRunSub="—"
                lastRun="—"
                lastRunOk="—"
                iconType="zakat"
              />
              <ScheduledRow
                name={t("reports.sched.late.name")}
                sub={t("reports.sched.late.sub")}
                cadenceLabel={t("reports.sched.late.cadence")}
                cadenceColor="gold"
                recipientCount="—"
                nextRun="—"
                nextRunSub={t("reports.sched.paused")}
                lastRun="—"
                lastRunOk="—"
                iconType="cross"
                paused
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          RECENT EXPORTS
          TODO(backend): recent-exports list has no endpoint yet.
          Rows are inert mockup data. Download/share buttons are disabled.
          ════════════════════════════════════════════════════════════ */}
      <div className="oa-reports-section-h" style={{ marginTop: 26 }}>
        <div className="ttl">
          <Icon>{ICONS.download}</Icon>
          {t("reports.recentExports")}
        </div>
        {/* TODO(backend): "view all" exports page doesn't exist yet */}
        <span className="oa-reports-view-all" aria-hidden="true">—</span>
      </div>

      <div className="oa-reports-recent-list" aria-label={t("reports.recentExports")}>
        {/* TODO(backend): file sizes and download counts come from no endpoint.
            All 4 rows are mockup data with "—" substituted for real values. */}
        <RecentExportRow
          format="pdf"
          name={t("reports.recent.r1.name")}
          meta={t("reports.recent.r1.meta")}
          size="—"
        />
        <RecentExportRow
          format="xls"
          name={t("reports.recent.r2.name")}
          meta={t("reports.recent.r2.meta")}
          size="—"
        />
        <RecentExportRow
          format="csv"
          name={t("reports.recent.r3.name")}
          meta={t("reports.recent.r3.meta")}
          size="—"
        />
        <RecentExportRow
          format="pdf"
          name={t("reports.recent.r4.name")}
          meta={t("reports.recent.r4.meta")}
          size="—"
        />
      </div>

      {/* ── Reject dialog ──────────────────────────────────────── */}
      {rejectingId && (
        <RejectDialog
          title={t("reports.actions.rejectReason")}
          isSubmitting={rejectMut.isPending}
          onCancel={() => setRejectingId(null)}
          onSubmit={(reason) => rejectMut.mutate({ id: rejectingId, reason })}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Scheduled row (static mockup shell — no live data)
// ════════════════════════════════════════════════════════════════════
type CadenceColor = "info" | "purple" | "rose" | "success" | "gold";
type IconType = "finance" | "partner" | "marketing" | "zakat" | "cross";

function scheduledRowIconStyle(
  t: IconType,
): React.CSSProperties {
  if (t === "partner")
    return { background: "var(--purple-50)", color: "var(--purple-700)" };
  if (t === "marketing")
    return { background: "var(--rose-50)", color: "var(--rose-700)" };
  if (t === "zakat")
    return { background: "var(--success-50)", color: "var(--success-700)" };
  if (t === "cross")
    return { background: "var(--gold-50)", color: "var(--gold-700)" };
  return {}; // finance = default tranquil
}

function cadencePillStyle(c: CadenceColor): React.CSSProperties {
  if (c === "purple")
    return {
      background: "var(--purple-50)",
      color: "var(--purple-700)",
      borderColor: "var(--purple-100)",
    };
  if (c === "rose")
    return {
      background: "var(--rose-50)",
      color: "var(--rose-700)",
      borderColor: "var(--rose-100)",
    };
  if (c === "success")
    return {
      background: "var(--success-50)",
      color: "var(--success-700)",
      borderColor: "var(--success-100)",
    };
  if (c === "gold")
    return {
      background: "var(--gold-50)",
      color: "var(--gold-700)",
      borderColor: "var(--gold-100)",
    };
  return {}; // info = default
}

function scheduledIconSvg(t: IconType): ReactNode {
  if (t === "partner")
    return (
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
    );
  if (t === "marketing")
    return <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />;
  if (t === "zakat")
    return (
      <>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </>
    );
  if (t === "cross")
    return (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </>
    );
  // finance
  return (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  );
}

function ScheduledRow({
  name,
  sub,
  cadenceLabel,
  cadenceColor,
  recipientCount,
  nextRun,
  nextRunSub,
  lastRun,
  lastRunOk,
  iconType,
  paused = false,
}: {
  name: string;
  sub: string;
  cadenceLabel: string;
  cadenceColor: CadenceColor;
  recipientCount: string;
  nextRun: string;
  nextRunSub: string;
  lastRun: string;
  lastRunOk: string;
  iconType: IconType;
  paused?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <tr>
      <td>
        <div className="oa-reports-sch-name">
          <span className="oa-reports-sch-ic" style={scheduledRowIconStyle(iconType)} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
              {scheduledIconSvg(iconType)}
            </svg>
          </span>
          <div className="oa-reports-sch-info">
            <div className="nm">{name}</div>
            <div className="sub">{sub}</div>
          </div>
        </div>
      </td>
      <td>
        <span className="oa-reports-cadence-pill" style={cadencePillStyle(cadenceColor)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          </svg>
          {cadenceLabel}
        </span>
      </td>
      <td>
        <span className="latin" style={{ fontSize: 12, color: "var(--gray-600)" }}>
          {recipientCount}
        </span>
      </td>
      <td>
        <div className="oa-reports-next-run latin">{nextRun}</div>
        <div className={`oa-reports-next-run sub${paused ? " paused" : ""}`}>
          {nextRunSub}
        </div>
      </td>
      <td>
        <div className="oa-reports-last-run latin">{lastRun}</div>
        <div className="oa-reports-last-run ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {lastRunOk}
        </div>
      </td>
      <td>
        <div className="oa-reports-sched-actions">
          <button
            type="button"
            className="oa-reports-icon-btn-sm"
            aria-label={t("reports.schedAction.settings")}
            disabled
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82" />
            </svg>
          </button>
          <button
            type="button"
            className="oa-reports-icon-btn-sm"
            aria-label={t("reports.schedAction.runNow")}
            disabled
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
          <button
            type="button"
            className="oa-reports-icon-btn-sm danger"
            aria-label={t("reports.schedAction.disable")}
            disabled
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════
// Recent export row (static mockup shell — no live data)
// ════════════════════════════════════════════════════════════════════
function RecentExportRow({
  format,
  name,
  meta,
  size,
}: {
  format: "pdf" | "xls" | "csv";
  name: string;
  meta: string;
  size: string;
}) {
  const { t } = useTranslation();
  const label = format === "xls" ? "XLSX" : format.toUpperCase();
  return (
    <div className="oa-reports-recent-row">
      <div
        className={`oa-reports-recent-icon ${format}`}
        aria-label={label}
        role="img"
      >
        {label}
      </div>
      <div className="oa-reports-recent-info">
        <div className="nm">{name}</div>
        <div className="meta">{meta}</div>
      </div>
      {/* TODO(backend): file size from export API not available */}
      <div className="oa-reports-recent-size mono" aria-label={t("reports.fileSize")}>
        {size}
      </div>
      <div className="oa-reports-recent-actions">
        {/* TODO(backend): download and share endpoints not implemented */}
        <button
          type="button"
          className="oa-reports-recent-action-btn"
          disabled
          aria-label={t("reports.download")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
          </svg>
          {t("reports.download")}
        </button>
        <button
          type="button"
          className="oa-reports-recent-action-btn"
          disabled
          aria-label={t("reports.shareFile")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          {t("reports.shareFile")}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Reject dialog (live — used for workflow transitions)
// ════════════════════════════════════════════════════════════════════
function RejectDialog({
  title,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  title: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > 1000) {
      setErr(t("common.required"));
      return;
    }
    setErr(null);
    onSubmit(trimmed);
  }

  return (
    <div
      className="oa-reports-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="oa-reports-dialog">
        <h3>{title}</h3>
        <textarea
          autoFocus
          rows={4}
          maxLength={1000}
          placeholder={t("orphans.actions.rejectReasonPlaceholder")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label={title}
        />
        {err && (
          <div className="oa-reports-error" role="alert">
            {err}
          </div>
        )}
        <div className="dlg-foot">
          <button
            type="button"
            className="oa-reports-btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="oa-reports-action-btn danger"
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? t("common.saving") : t("reports.actions.rejectSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}

