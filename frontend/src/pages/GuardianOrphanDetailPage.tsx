import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import type { DocumentType } from "@/lib/documents";
import {
  listGuardianOrphanDocuments,
  listGuardianOrphans,
  listGuardianReports,
  uploadGuardianOrphanDocument,
  type GuardianOrphan,
  type GuardianReport,
} from "@/lib/guardianSelf";
import { ageFromDob } from "@/lib/orphanSelf";
import { toast } from "@/store/toasts";

import "./GuardianOrphanDetailPage.css";

type TabKey = "overview" | "reports" | "documents" | "photos" | "messages";

/** G-03 — detail page for one of the guardian's orphans. Profile facts come
 * from GET /guardian/me/orphans (filtered to this id); the Reports tab reads
 * the live GET /guardian/me/reports. Photos has no guardian-facing read
 * endpoint yet, so it shows a "coming soon" state.
 *
 * CHILD-DATA SENSITIVITY: only the API's privacy-safe projection is rendered.
 * Money/balance/sponsorship are shown ONLY when the server attaches the
 * `financials` object (org opted in via show_financial_to_guardian). The
 * donor is shown only as the anonymised "كفيل <name>", never a real name. */
export function GuardianOrphanDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const [tab, setTab] = useState<TabKey>("overview");

  const orphans = useQuery({
    queryKey: ["guardian", "me", "orphans"],
    queryFn: listGuardianOrphans,
  });
  const reports = useQuery({
    queryKey: ["guardian", "me", "reports", id],
    queryFn: () => listGuardianReports(id),
    enabled: Boolean(id),
  });

  const orphan = orphans.data?.find((o) => o.id === id);

  if (orphans.isLoading) {
    return (
      <div className="god-root">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (orphans.data && !orphan) {
    return (
      <div className="god-root">
        <div className="god-state" role="alert">
          <p>{t("guardian.detail.notFound")}</p>
          <Link to="/guardian" className="god-back-link">
            {t("guardian.detail.backHome")}
          </Link>
        </div>
      </div>
    );
  }

  if (!orphan) return null;

  const fullName = `${orphan.first_name} ${orphan.family_name}`.trim();
  const age = ageFromDob(orphan.date_of_birth);
  const reportList = reports.data ?? [];
  const lastReport = reportList[0];

  return (
    <div className="god-root">
      {/* Breadcrumb */}
      <nav className="god-breadcrumb" aria-label={t("guardian.detail.breadcrumbLabel")}>
        <Link to="/guardian">{t("guardian.nav.home")}</Link>
        <span className="god-breadcrumb-sep" aria-hidden="true">
          ‹
        </span>
        <span aria-current="page">{fullName}</span>
      </nav>

      <div className="god-layout">
        {/* Main column */}
        <div className="god-main">
          {/* Hero */}
          <section className="god-hero" aria-labelledby="god-name">
            <span className="god-hero-avatar" aria-hidden="true">
              {orphan.first_name.slice(0, 1)}
            </span>
            <div className="god-hero-identity">
              <h1 className="god-hero-name" id="god-name">
                {fullName}
              </h1>
              <p className="god-hero-sub">
                <span>{t("guardian.home.ageYears", { count: age })}</span>
                <span className="god-sub-dot" aria-hidden="true" />
                <span>
                  {t(`guardian.gender.${orphan.gender}`, {
                    defaultValue: orphan.gender,
                  })}
                </span>
                <span className="god-sub-dot" aria-hidden="true" />
                <span className="god-code">{orphan.code}</span>
              </p>
              <div className="god-hero-badges">
                <span
                  className={`god-badge${
                    orphan.case_status === "active" ? " god-badge--success" : ""
                  }`}
                >
                  <span className="god-badge-dot" aria-hidden="true" />
                  {t(`guardian.caseStatus.${orphan.case_status}`, {
                    defaultValue: orphan.case_status,
                  })}
                </span>
              </div>
            </div>
          </section>

          {/* Tabs */}
          <section className="god-tabs-wrap" aria-label={t("guardian.detail.tabsLabel")}>
            <div className="god-tabs" role="tablist">
              <TabButton id="overview" current={tab} onSelect={setTab}>
                {t("guardian.detail.tabOverview")}
              </TabButton>
              <TabButton id="reports" current={tab} onSelect={setTab} count={reportList.length}>
                {t("guardian.detail.tabReports")}
              </TabButton>
              <TabButton id="documents" current={tab} onSelect={setTab}>
                {t("guardian.detail.tabDocuments")}
              </TabButton>
              <TabButton id="photos" current={tab} onSelect={setTab}>
                {t("guardian.detail.tabPhotos")}
              </TabButton>
              <TabButton id="messages" current={tab} onSelect={setTab}>
                {t("guardian.detail.tabMessages")}
              </TabButton>
            </div>

            {tab === "overview" && (
              <div role="tabpanel" className="god-tab-panel">
                <h2 className="god-panel-title">{t("guardian.detail.basicInfo")}</h2>
                <dl className="god-info-grid">
                  <InfoRow label={t("guardian.detail.age")} value={t("guardian.home.ageYears", { count: age })} />
                  <InfoRow
                    label={t("guardian.detail.dob")}
                    value={new Date(orphan.date_of_birth).toLocaleDateString(i18n.language)}
                  />
                  <InfoRow
                    label={t("guardian.detail.gender")}
                    value={t(`guardian.gender.${orphan.gender}`, { defaultValue: orphan.gender })}
                  />
                  <InfoRow label={t("guardian.detail.code")} value={orphan.code} />
                  <InfoRow
                    label={t("guardian.detail.completion")}
                    value={`${orphan.profile_completion_percentage}%`}
                  />
                  <InfoRow
                    label={t("guardian.detail.status")}
                    value={t(`guardian.caseStatus.${orphan.case_status}`, {
                      defaultValue: orphan.case_status,
                    })}
                  />
                </dl>
                <p className="god-panel-note">{t("guardian.detail.maintainedByOrg")}</p>
              </div>
            )}

            {tab === "reports" && (
              <div role="tabpanel" className="god-tab-panel">
                <h2 className="god-panel-title">
                  {t("guardian.detail.reportsTitle")}
                  <Link
                    to={`/guardian/orphans/${orphan.id}/report`}
                    className="god-panel-cta"
                  >
                    {t("guardian.home.uploadReport")}
                  </Link>
                </h2>

                {reports.isLoading && <Skeleton className="h-24 w-full" />}
                {reports.isError && (
                  <div className="god-state god-state--error" role="alert">
                    {t("guardian.detail.reportsError")}
                  </div>
                )}
                {reports.data && reportList.length === 0 && (
                  <div className="god-state">
                    <span className="god-state-emoji" aria-hidden="true">
                      📄
                    </span>
                    <p>{t("guardian.detail.noReports")}</p>
                  </div>
                )}
                {reportList.length > 0 && (
                  <ul className="god-report-list">
                    {reportList.map((r) => (
                      <ReportCard key={r.id} report={r} lang={i18n.language} />
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === "documents" && (
              <div role="tabpanel" className="god-tab-panel">
                <h2 className="god-panel-title">{t("guardian.detail.documentsTitle")}</h2>
                <GuardianDocumentsPanel orphanId={orphan.id} lang={i18n.language} />
              </div>
            )}

            {tab === "photos" && (
              <div role="tabpanel" className="god-tab-panel">
                <div className="god-soon">
                  <span className="god-soon-icon" aria-hidden="true">
                    <svg className="god-icon god-icon-lg" viewBox="0 0 24 24">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                  <h3>{t("guardian.detail.photosSoonTitle")}</h3>
                  <p>{t("guardian.detail.photosSoonBody")}</p>
                </div>
              </div>
            )}

            {tab === "messages" && (
              <div role="tabpanel" className="god-tab-panel">
                <div className="god-review-notice" role="status">
                  <ShieldIcon />
                  {t("guardian.detail.messagesModeration")}
                </div>
                <div className="god-soon">
                  <span className="god-soon-icon" aria-hidden="true">
                    <MailIcon />
                  </span>
                  <h3>{t("guardian.detail.messagesSoonTitle")}</h3>
                  <p>{t("guardian.detail.messagesSoonBody")}</p>
                  <Link to="/guardian/messages" className="god-soon-link">
                    {t("guardian.detail.openMessages")}
                  </Link>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="god-sidebar" aria-label={t("guardian.detail.quickActionsLabel")}>
          <div className="god-side-card">
            <h2 className="god-side-title">{t("guardian.detail.quickActionsLabel")}</h2>
            <div className="god-side-body">
              <Link
                to={`/guardian/orphans/${orphan.id}/report`}
                className="god-action god-action--primary"
              >
                <span className="god-action-icon" aria-hidden="true">
                  <svg className="god-icon" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <span className="god-action-text">
                  <span className="god-action-title">
                    {t("guardian.detail.actionNewReport")}
                  </span>
                  <span className="god-action-sub">
                    {t("guardian.detail.actionNewReportSub")}
                  </span>
                </span>
              </Link>

              <button
                type="button"
                className="god-action"
                onClick={() => setTab("documents")}
              >
                <span className="god-action-icon" aria-hidden="true">
                  <svg className="god-icon" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <span className="god-action-text">
                  <span className="god-action-title">
                    {t("guardian.detail.actionDocuments")}
                  </span>
                  <span className="god-action-sub">
                    {t("guardian.detail.actionDocumentsSub")}
                  </span>
                </span>
              </button>

              <Link to="/guardian/messages" className="god-action">
                <span className="god-action-icon" aria-hidden="true">
                  <MailIcon />
                </span>
                <span className="god-action-text">
                  <span className="god-action-title">
                    {t("guardian.detail.actionMessage")}
                  </span>
                  <span className="god-action-sub">
                    {t("guardian.detail.actionMessageSub")}
                  </span>
                </span>
              </Link>
            </div>
          </div>

          {/* Sponsor — anonymised, never a real donor name/contact */}
          <div className="god-sponsor-card">
            <span className="god-sponsor-icon" aria-hidden="true">
              <svg className="god-icon god-icon-lg" viewBox="0 0 24 24">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </span>
            <p className="god-sponsor-label">
              {t("guardian.detail.sponsorLabel", { name: orphan.first_name })}
            </p>
            <p className="god-sponsor-name">
              {t("guardian.detail.sponsorName", { name: orphan.first_name })}
            </p>
            <p className="god-sponsor-tag">{t("guardian.detail.sponsorTag")}</p>
          </div>

          {/* Financials — rendered ONLY when the org opted in and the server
              actually returned the financials object. */}
          {orphan.financials && (
            <FinancialsCard financials={orphan.financials} lang={i18n.language} />
          )}

          {lastReport && (
            <div className="god-side-card">
              <h2 className="god-side-title">{t("guardian.detail.lastReportTitle")}</h2>
              <div className="god-side-body">
                <p className="god-last-report">
                  {formatPeriod(lastReport, i18n.language)}
                  {" · "}
                  {t(`guardian.reportStatus.${lastReport.status}`, {
                    defaultValue: lastReport.status,
                  })}
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TabButton({
  id,
  current,
  onSelect,
  count,
  children,
}: {
  id: TabKey;
  current: TabKey;
  onSelect: (t: TabKey) => void;
  count?: number;
  children: React.ReactNode;
}) {
  const active = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`god-tab${active ? " god-tab--active" : ""}`}
      onClick={() => onSelect(id)}
    >
      {children}
      {count != null && count > 0 && <span className="god-tab-count">{count}</span>}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="god-info-row">
      <dt className="god-info-label">{label}</dt>
      <dd className="god-info-value">{value}</dd>
    </div>
  );
}

function ReportCard({ report, lang }: { report: GuardianReport; lang: string }) {
  const { t } = useTranslation();
  return (
    <li className="god-report-card">
      <div className="god-report-period" aria-hidden="true">
        {new Date(report.period_start).toLocaleDateString(lang, {
          month: "short",
        })}
      </div>
      <div className="god-report-info">
        <div className="god-report-title">
          {t(`guardian.reportType.${report.report_type}`, {
            defaultValue: report.report_type,
          })}
          <span className="god-report-badge">
            {t(`guardian.reportStatus.${report.status}`, {
              defaultValue: report.status,
            })}
          </span>
        </div>
        {report.summary && <p className="god-report-summary">{report.summary}</p>}
        <div className="god-report-meta">
          <span>{formatPeriod(report, lang)}</span>
          {report.photos_count > 0 && (
            <span>{t("guardian.detail.photosCount", { count: report.photos_count })}</span>
          )}
        </div>
      </div>
    </li>
  );
}

function FinancialsCard({
  financials,
  lang,
}: {
  financials: NonNullable<GuardianOrphan["financials"]>;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="god-side-card">
      <h2 className="god-side-title">{t("guardian.detail.financialsTitle")}</h2>
      <div className="god-side-body">
        <dl className="god-info-grid god-info-grid--compact">
          <InfoRow
            label={t("guardian.detail.sponsored")}
            value={
              financials.is_sponsored
                ? t("guardian.detail.yes")
                : t("guardian.detail.no")
            }
          />
          {financials.current_balance != null && (
            <InfoRow
              label={t("guardian.detail.balance")}
              value={`${Number(financials.current_balance).toLocaleString(lang)} ${
                financials.balance_currency ?? ""
              }`.trim()}
            />
          )}
        </dl>
      </div>
    </div>
  );
}

function formatPeriod(report: GuardianReport, lang: string): string {
  return new Date(report.period_start).toLocaleDateString(lang, {
    year: "numeric",
    month: "long",
  });
}

function MailIcon() {
  return (
    <svg className="god-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="god-icon god-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

// Guardians may upload any document type for their orphan (staff verify it).
const DOC_TYPES: DocumentType[] = [
  "school_certificate",
  "medical_report",
  "birth_certificate",
  "death_certificate",
  "national_id",
  "passport",
  "bank_statement",
  "photo_id",
  "family_record",
  "other",
];

/** G-03 "تحديث المستندات": upload a document (lands verification_status=
 * 'pending') and list the orphan's documents with their review status. The
 * backend enforces family ownership; this is only ever the guardian's own
 * orphan. */
function GuardianDocumentsPanel({ orphanId, lang }: { orphanId: string; lang: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<DocumentType>("school_certificate");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const docs = useQuery({
    queryKey: ["guardian", "me", "documents", orphanId],
    queryFn: () => listGuardianOrphanDocuments(orphanId),
  });

  const upload = useMutation({
    mutationFn: (vars: { file: File; docType: DocumentType }) =>
      uploadGuardianOrphanDocument(orphanId, vars.file, vars.docType),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["guardian", "me", "documents", orphanId] });
      toast.success(t("guardian.detail.docUploadSuccess"));
      setFile(null);
      setFileKey((k) => k + 1); // reset the <input type=file>
    },
    onError: (err) => {
      const detail = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof detail === "string" ? detail : t("guardian.detail.docUploadError"));
    },
  });

  const list = docs.data ?? [];

  return (
    <>
      <div className="god-doc-upload">
        <div className="god-doc-upload-row">
          <label className="god-doc-field">
            <span className="god-doc-field-label">{t("guardian.detail.docType")}</span>
            <select
              className="god-doc-select"
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
            >
              {DOC_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {t(`guardian.docType.${dt}`, { defaultValue: dt })}
                </option>
              ))}
            </select>
          </label>
          <label className="god-doc-field">
            <span className="god-doc-field-label">{t("guardian.detail.docFile")}</span>
            <input
              key={fileKey}
              type="file"
              className="god-doc-file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          type="button"
          className="god-doc-upload-btn"
          disabled={!file || upload.isPending}
          onClick={() => file && upload.mutate({ file, docType })}
        >
          {upload.isPending ? t("guardian.detail.docUploading") : t("guardian.detail.docUpload")}
        </button>
        <p className="god-doc-hint">
          <ShieldIcon />
          {t("guardian.detail.docReviewNote")}
        </p>
      </div>

      {docs.isLoading && <Skeleton className="h-24 w-full" />}
      {docs.isError && (
        <div className="god-state god-state--error" role="alert">
          {t("guardian.detail.docsError")}
        </div>
      )}
      {docs.data && list.length === 0 && (
        <div className="god-state">
          <span className="god-state-emoji" aria-hidden="true">
            📁
          </span>
          <p>{t("guardian.detail.noDocs")}</p>
        </div>
      )}
      {list.length > 0 && (
        <ul className="god-doc-list">
          {list.map((d) => (
            <li key={d.id} className="god-doc-card">
              <span className="god-doc-icon" aria-hidden="true">
                <svg className="god-icon" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <div className="god-doc-info">
                <div className="god-doc-name">
                  {d.title?.trim() ||
                    t(`guardian.docType.${d.document_type}`, {
                      defaultValue: d.document_type,
                    })}
                </div>
                <div className="god-doc-meta">
                  <span>
                    {t(`guardian.docType.${d.document_type}`, {
                      defaultValue: d.document_type,
                    })}
                  </span>
                  <span>{new Date(d.created_at).toLocaleDateString(lang)}</span>
                </div>
              </div>
              <DocStatusBadge status={d.verification_status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const modifier =
    status === "verified"
      ? "god-doc-badge--ok"
      : status === "rejected" || status === "expired"
        ? "god-doc-badge--no"
        : "god-doc-badge--pending";
  return (
    <span className={`god-doc-badge ${modifier}`}>
      {t(`guardian.docStatus.${status}`, { defaultValue: status })}
    </span>
  );
}
