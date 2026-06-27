import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { ProfileVisibilityPanel } from "@/components/ProfileVisibilityPanel";
import { Skeleton } from "@/components/Skeleton";
import {
  listOrphanageReports,
  listOrphanageResidents,
  type OrphanageReport,
} from "@/lib/orphanageSelf";
import { ageFromDob } from "@/lib/orphanSelf";

// Mirror the guardian detail page; reuse its styles (god-*).
import "./GuardianOrphanDetailPage.css";

type TabKey = "overview" | "reports" | "visibility";

/** Detail page for one of the dar's resident orphans. Profile facts come from
 * GET /orphanage/me/orphans (filtered to this id); the Reports tab reads the
 * live GET /orphanage/me/reports. Mirrors the guardian detail page, trimmed to
 * the surfaces the manager portal backs (overview + reports).
 *
 * Only the API's privacy-safe projection is rendered — no money/balance,
 * sponsorship, or donor identity. */
export function OrphanageManagerOrphanDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const [tab, setTab] = useState<TabKey>("overview");

  const residents = useQuery({
    queryKey: ["orphanage", "me", "orphans"],
    queryFn: listOrphanageResidents,
  });
  const reports = useQuery({
    queryKey: ["orphanage", "me", "reports", id],
    queryFn: () => listOrphanageReports(id),
    enabled: Boolean(id),
  });

  const orphan = residents.data?.find((o) => o.id === id);

  if (residents.isLoading) {
    return (
      <div className="god-root">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (residents.data && !orphan) {
    return (
      <div className="god-root">
        <div className="god-state" role="alert">
          <p>{t("orphanageManager.detail.notFound")}</p>
          <Link to="/orphanage-manager" className="god-back-link">
            {t("orphanageManager.detail.backHome")}
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
      <nav className="god-breadcrumb" aria-label={t("orphanageManager.detail.breadcrumbLabel")}>
        <Link to="/orphanage-manager">{t("orphanageManager.nav.home")}</Link>
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
                <span>{t("orphanageManager.home.ageYears", { count: age })}</span>
                <span className="god-sub-dot" aria-hidden="true" />
                <span>
                  {t(`orphanageManager.gender.${orphan.gender}`, {
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
                  {t(`orphanageManager.caseStatus.${orphan.case_status}`, {
                    defaultValue: orphan.case_status,
                  })}
                </span>
              </div>
            </div>
          </section>

          {/* Tabs */}
          <section className="god-tabs-wrap" aria-label={t("orphanageManager.detail.tabsLabel")}>
            <div className="god-tabs" role="tablist">
              <TabButton id="overview" current={tab} onSelect={setTab}>
                {t("orphanageManager.detail.tabOverview")}
              </TabButton>
              <TabButton id="reports" current={tab} onSelect={setTab} count={reportList.length}>
                {t("orphanageManager.detail.tabReports")}
              </TabButton>
              <TabButton id="visibility" current={tab} onSelect={setTab}>
                {t("orphanageManager.detail.tabVisibility")}
              </TabButton>
            </div>

            {tab === "overview" && (
              <div role="tabpanel" className="god-tab-panel">
                <h2 className="god-panel-title">{t("orphanageManager.detail.basicInfo")}</h2>
                <dl className="god-info-grid">
                  <InfoRow
                    label={t("orphanageManager.detail.age")}
                    value={t("orphanageManager.home.ageYears", { count: age })}
                  />
                  <InfoRow
                    label={t("orphanageManager.detail.dob")}
                    value={new Date(orphan.date_of_birth).toLocaleDateString(i18n.language)}
                  />
                  <InfoRow
                    label={t("orphanageManager.detail.gender")}
                    value={t(`orphanageManager.gender.${orphan.gender}`, {
                      defaultValue: orphan.gender,
                    })}
                  />
                  <InfoRow label={t("orphanageManager.detail.code")} value={orphan.code} />
                  <InfoRow
                    label={t("orphanageManager.detail.completion")}
                    value={`${orphan.profile_completion_percentage}%`}
                  />
                  <InfoRow
                    label={t("orphanageManager.detail.status")}
                    value={t(`orphanageManager.caseStatus.${orphan.case_status}`, {
                      defaultValue: orphan.case_status,
                    })}
                  />
                </dl>
                <p className="god-panel-note">{t("orphanageManager.detail.maintainedByOrg")}</p>
              </div>
            )}

            {tab === "visibility" && (
              <div role="tabpanel" className="god-tab-panel">
                <h2 className="god-panel-title">{t("orphanageManager.detail.visibilityTitle")}</h2>
                <ProfileVisibilityPanel orphanId={orphan.id} />
              </div>
            )}

            {tab === "reports" && (
              <div role="tabpanel" className="god-tab-panel">
                <h2 className="god-panel-title">
                  {t("orphanageManager.detail.reportsTitle")}
                  <Link
                    to={`/orphanage-manager/orphans/${orphan.id}/report`}
                    className="god-panel-cta"
                  >
                    {t("orphanageManager.home.uploadReport")}
                  </Link>
                </h2>

                {reports.isLoading && <Skeleton className="h-24 w-full" />}
                {reports.isError && (
                  <div className="god-state god-state--error" role="alert">
                    {t("orphanageManager.detail.reportsError")}
                  </div>
                )}
                {reports.data && reportList.length === 0 && (
                  <div className="god-state">
                    <span className="god-state-emoji" aria-hidden="true">
                      📄
                    </span>
                    <p>{t("orphanageManager.detail.noReports")}</p>
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
          </section>
        </div>

        {/* Sidebar */}
        <aside className="god-sidebar" aria-label={t("orphanageManager.detail.quickActionsLabel")}>
          <div className="god-side-card">
            <h2 className="god-side-title">{t("orphanageManager.detail.quickActionsLabel")}</h2>
            <div className="god-side-body">
              <Link
                to={`/orphanage-manager/orphans/${orphan.id}/report`}
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
                    {t("orphanageManager.detail.actionNewReport")}
                  </span>
                  <span className="god-action-sub">
                    {t("orphanageManager.detail.actionNewReportSub")}
                  </span>
                </span>
              </Link>
            </div>
          </div>

          {lastReport && (
            <div className="god-side-card">
              <h2 className="god-side-title">{t("orphanageManager.detail.lastReportTitle")}</h2>
              <div className="god-side-body">
                <p className="god-last-report">
                  {formatPeriod(lastReport, i18n.language)}
                  {" · "}
                  {t(`orphanageManager.reportStatus.${lastReport.status}`, {
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

function ReportCard({ report, lang }: { report: OrphanageReport; lang: string }) {
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
          {t(`orphanageManager.reportType.${report.report_type}`, {
            defaultValue: report.report_type,
          })}
          <span className="god-report-badge">
            {t(`orphanageManager.reportStatus.${report.status}`, {
              defaultValue: report.status,
            })}
          </span>
        </div>
        {report.summary && <p className="god-report-summary">{report.summary}</p>}
        <div className="god-report-meta">
          <span>{formatPeriod(report, lang)}</span>
        </div>
      </div>
    </li>
  );
}

function formatPeriod(report: OrphanageReport, lang: string): string {
  return new Date(report.period_start).toLocaleDateString(lang, {
    year: "numeric",
    month: "long",
  });
}
