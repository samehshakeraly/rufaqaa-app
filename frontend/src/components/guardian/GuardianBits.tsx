import { useTranslation } from "react-i18next";

import type { ReportStatus } from "@/lib/reports";

const BADGE_BASE =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  success: "bg-success-100 text-success-700",
  warning: "bg-warning-100 text-warning-700",
  danger: "bg-danger-100 text-danger-700",
  info: "bg-info-100 text-info-700",
  neutral: "bg-gray-100 text-gray-700",
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`${BADGE_BASE} ${TONE[tone]}`}>{children}</span>;
}

const CASE_TONE: Record<string, Tone> = {
  active: "success",
  approved: "success",
  pending: "warning",
  draft: "neutral",
  rejected: "danger",
  released: "info",
  archived: "neutral",
};

export function CaseStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone={CASE_TONE[status] ?? "neutral"}>
      {t(`guardian.caseStatus.${status}`, { defaultValue: status })}
    </Badge>
  );
}

const REPORT_TONE: Record<ReportStatus, Tone> = {
  draft: "neutral",
  pending_partner_approval: "warning",
  partner_approved: "info",
  pending_org_approval: "warning",
  org_approved: "info",
  published_to_donor: "success",
  rejected: "danger",
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={REPORT_TONE[status] ?? "neutral"}>
      {t(`guardian.report.statuses.${status}`, { defaultValue: status })}
    </Badge>
  );
}

/** Privacy-safe sponsorship signal. Renders ONLY a badge — never an
 * amount, balance, or sponsor identity. */
export function SponsoredBadge({ short = false }: { short?: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge tone="success">
      {short ? t("guardian.orphan.sponsoredShort") : t("guardian.orphan.sponsored")}
    </Badge>
  );
}
