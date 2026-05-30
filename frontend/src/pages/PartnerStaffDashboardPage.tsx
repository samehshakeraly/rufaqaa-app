import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { type Orphan, listOrphans } from "@/lib/orphans";
import { type Report, listReports } from "@/lib/reports";

import { DashboardPage } from "./DashboardPage";
import "./PartnerStaffDashboardPage.css";

// ── Inline icon set (stroke icons, sized via .ps-icon utility) ──────────
function Icon({ children, className = "ps-icon ps-icon-sm" }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}
const ICONS = {
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  bars: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  chevronStart: <polyline points="15 18 9 12 15 6" />,
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
};

const PLACEHOLDER = "—";

/** Route element for /admin/dashboard: partner_staff users get the
 * staff-focused dashboard (PS-01); everyone else keeps the executive
 * dashboard (OA-01). Keeps the e2e admin smoke test on DashboardPage. */
export function DashboardHome() {
  const { isPartnerStaff } = useRole();
  return isPartnerStaff ? <PartnerStaffDashboardPage /> : <DashboardPage />;
}

function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

function initial(name: string | null | undefined): string {
  return name?.trim()?.[0] ?? "—";
}

export function PartnerStaffDashboardPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useCurrentUser();

  // Active orphans — total of all managed cases.
  const allQuery = useQuery({
    queryKey: ["orphans", { limit: 1, offset: 0, q: "", caseStatus: "ps-all" }],
    queryFn: () => listOrphans({ limit: 1 }),
  });
  // Cases pending approval — partner_staff submit them, a manager decides.
  const pendingQuery = useQuery({
    queryKey: ["orphans", { limit: 6, offset: 0, q: "", caseStatus: "pending_review" }],
    queryFn: () => listOrphans({ limit: 6, case_status: "pending_review" }),
  });
  // Recently registered orphans (most recent first slice of the list).
  const recentQuery = useQuery({
    queryKey: ["orphans", { limit: 6, offset: 0, q: "", caseStatus: "ps-recent" }],
    queryFn: () => listOrphans({ limit: 6 }),
  });
  // Reports waiting in the partner review queue.
  const reportsQuery = useQuery({
    queryKey: ["reports", { status: "pending_partner_approval", limit: 6 }],
    queryFn: () => listReports({ status: "pending_partner_approval", limit: 6 }),
  });

  const num = (n: number | undefined) =>
    n === undefined ? PLACEHOLDER : n.toLocaleString(i18n.language, { maximumFractionDigits: 0 });

  const activeTotal = allQuery.data?.total;
  const pendingTotal = pendingQuery.data?.total;
  const reportsTotal = reportsQuery.data?.total;

  return (
    <div className="ps-dash">
      {/* The single semantic h1. Visually hidden because the app top-bar
          already shows the page name; keeps screen readers and the login
          smoke test anchored on the page name. */}
      <h1 className="sr-only">{t("psDash.title")}</h1>

      {/* ── Greeting ──────────────────────────────────────────────── */}
      <div className="ps-greeting">
        <div>
          <h2>{t("psDash.greeting", { name: me?.first_name ?? "" })}</h2>
          <p>
            {t("psDash.greetingSubtitle", {
              reports: reportsTotal ?? 0,
              pending: pendingTotal ?? 0,
            })}
          </p>
        </div>
        <Link to="/admin/orphans/new" className="ps-quick-add">
          <Icon>{ICONS.plus}</Icon>
          {t("psDash.registerCta")}
        </Link>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────── */}
      <div className="ps-kpi-grid">
        <KpiCard
          icon={ICONS.users}
          iconClass="orphans"
          label={t("psDash.kpi.activeOrphans")}
          value={num(activeTotal)}
          unit={t("psDash.kpi.activeOrphansUnit")}
          foot={t("psDash.kpi.activeOrphansFoot")}
        />
        <KpiCard
          icon={ICONS.clock}
          iconClass="review"
          label={t("psDash.kpi.pendingApproval")}
          value={num(pendingTotal)}
          unit={t("psDash.kpi.pendingApprovalUnit")}
          foot={t("psDash.kpi.pendingApprovalFoot")}
          footClass="warn"
        />
        <KpiCard
          icon={ICONS.file}
          iconClass="reports"
          label={t("psDash.kpi.reportsReceived")}
          value={num(reportsTotal)}
          unit={t("psDash.kpi.reportsReceivedUnit")}
          foot={t("psDash.kpi.reportsReceivedFoot")}
        />
        {/* TODO(backend): no media-review list endpoint yet (see
            MediaReviewPage). Photo count cannot be sourced — shown muted. */}
        <KpiCard
          icon={ICONS.image}
          iconClass="media"
          label={t("psDash.kpi.photosReview")}
          value={PLACEHOLDER}
          unit={t("psDash.kpi.photosReviewUnit")}
          foot={t("psDash.comingSoon")}
        />
      </div>

      {/* ── Two-column grid ───────────────────────────────────────── */}
      <div className="ps-grid">
        {/* Left column */}
        <div>
          {/* Tasks today — TODO(backend): no task/worklist endpoint yet. */}
          <div className="ps-card">
            <div className="ps-card-head">
              <h3>
                <Icon>{ICONS.check}</Icon>
                {t("psDash.tasks.title")}
              </h3>
            </div>
            <EmptyState
              title={t("psDash.comingSoon")}
              body={t("psDash.comingSoonBody")}
              icon={ICONS.check}
            />
          </div>

          {/* Recently registered orphans */}
          <div className="ps-card">
            <div className="ps-card-head">
              <h3>
                <Icon>{ICONS.plus}</Icon>
                {t("psDash.newOrphans.title")}
                {recentQuery.data && (
                  <span className="ps-pill">
                    <span className="latin">{num(recentQuery.data.items.length)}</span>
                  </span>
                )}
              </h3>
              <Link to="/admin/orphans" className="ps-head-link">
                {t("psDash.newOrphans.viewAll")}
              </Link>
            </div>
            {recentQuery.data && recentQuery.data.items.length > 0 ? (
              <div className="ps-new-strip">
                {recentQuery.data.items.map((o) => (
                  <NewOrphanMini key={o.id} orphan={o} lang={i18n.language} />
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("psDash.newOrphans.empty")}
                body=""
                icon={ICONS.users}
              />
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Performance — TODO(backend): no per-staff activity metric. */}
          <div className="ps-card">
            <div className="ps-card-head">
              <h3>
                <Icon>{ICONS.bars}</Icon>
                {t("psDash.performance.title")}
              </h3>
            </div>
            <EmptyState
              title={t("psDash.comingSoon")}
              body={t("psDash.comingSoonBody")}
              icon={ICONS.bars}
            />
          </div>

          {/* Reports to review queue. partner_staff open reports; the
              approve/reject decision belongs to partner_manager. */}
          <div className="ps-card">
            <div className="ps-card-head">
              <h3>
                <Icon>{ICONS.file}</Icon>
                {t("psDash.reportsQueue.title")}
                {reportsTotal !== undefined && (
                  <span className="ps-pill">
                    <span className="latin">{num(reportsTotal)}</span>
                  </span>
                )}
              </h3>
              <Link to="/admin/reports" className="ps-head-link">
                {t("psDash.reportsQueue.inbox")}
              </Link>
            </div>
            {reportsQuery.data && reportsQuery.data.items.length > 0 ? (
              <div className="ps-card-body">
                {reportsQuery.data.items.map((r) => (
                  <ReportQueueRow key={r.id} report={r} lang={i18n.language} />
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("psDash.reportsQueue.empty")}
                body=""
                icon={ICONS.inbox}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  unit,
  foot,
  footClass = "",
}: {
  icon: ReactNode;
  iconClass: string;
  label: string;
  value: string;
  unit: string;
  foot: string;
  footClass?: string;
}) {
  return (
    <article className="ps-kpi" aria-label={`${label}: ${value} ${unit}`}>
      <div className="ps-kpi-head">
        <div className={`ps-kpi-icon ${iconClass}`} aria-hidden="true">
          <Icon>{icon}</Icon>
        </div>
        {/* Decorative placeholder spark — no per-KPI timeseries source,
            rendered muted so it doesn't assert a trend. */}
        <svg className="ps-kpi-spark" viewBox="0 0 60 30" aria-hidden="true">
          <polyline className="ps-kpi-spark-line" points="0,20 10,18 20,21 30,15 40,17 50,12 60,14" />
        </svg>
      </div>
      <div className="ps-kpi-label">{label}</div>
      <div className="ps-kpi-value">
        <span className="latin">{value}</span> <span className="unit">{unit}</span>
      </div>
      <div className={`ps-kpi-foot ${footClass}`}>{foot}</div>
    </article>
  );
}

function NewOrphanMini({ orphan, lang }: { orphan: Orphan; lang: string }) {
  const { t } = useTranslation();
  const age = ageFromDob(orphan.date_of_birth);
  const created = new Date(orphan.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? ""
    : created.toLocaleDateString(lang, { day: "numeric", month: "short" });
  const meta = [
    age !== null ? t("psDash.newOrphans.yearsOld", { count: age }) : null,
    createdLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link to={`/admin/orphans/${orphan.id}`} className="ps-new-mini">
      <div className="ps-new-photo" aria-hidden="true">
        {initial(orphan.first_name)}
      </div>
      <div>
        <div className="ps-new-name">
          {orphan.first_name} {initial(orphan.family_name)}.
        </div>
        <div className="ps-new-meta">{meta}</div>
      </div>
    </Link>
  );
}

function ReportQueueRow({ report, lang }: { report: Report; lang: string }) {
  const { t } = useTranslation();
  const created = new Date(report.created_at);
  const createdLabel = Number.isNaN(created.getTime())
    ? ""
    : created.toLocaleDateString(lang, { day: "numeric", month: "short" });
  const typeLabel = t(`reports.types.${report.report_type}`, report.report_type);
  return (
    <Link to={`/admin/reports/${report.id}`} className="ps-queue-row">
      <div className="ps-queue-avatar" aria-hidden="true">
        {initial(typeLabel)}
      </div>
      <div className="ps-queue-text">
        <div className="ps-queue-name">{typeLabel}</div>
        <div className="ps-queue-meta">
          <span className="tabular-nums">
            {report.period_start} → {report.period_end}
          </span>
          {createdLabel && (
            <>
              <span className="dot" aria-hidden="true" />
              <span>{createdLabel}</span>
            </>
          )}
        </div>
      </div>
      <span className="ps-queue-cta">
        {t("reports.open")}
        <Icon>{ICONS.chevronStart}</Icon>
      </span>
    </Link>
  );
}

function EmptyState({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
  return (
    <div className="ps-empty">
      <Icon className="ps-icon">{icon}</Icon>
      <div className="ps-empty-title">{title}</div>
      {body ? <div className="ps-empty-sub">{body}</div> : null}
    </div>
  );
}
