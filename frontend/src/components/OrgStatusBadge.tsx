import { useTranslation } from "react-i18next";

/**
 * Coloured status pill for a platform organisation. Colours come from the
 * design-system semantic tokens (success / warning / danger / gray) so
 * contrast stays ≥ 4.5:1 in both themes.
 */
const STYLES: Record<string, string> = {
  active: "bg-success-100 text-success-700",
  suspended: "bg-danger-100 text-danger-700",
  pending_approval: "bg-warning-100 text-warning-700",
  archived: "bg-gray-200 text-gray-600",
};

export function OrgStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls = STYLES[status] ?? "bg-gray-200 text-gray-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {t(`platform.orgStatus.${status}`, status)}
    </span>
  );
}
