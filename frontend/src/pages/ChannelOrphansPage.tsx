import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import { getMarketingChannel } from "@/lib/marketingChannels";
import {
  type AssignmentStatus,
  listOrphans,
  releaseOrphan,
} from "@/lib/orphans";
import { toast } from "@/store/toasts";

const STATUS_OPTIONS: AssignmentStatus[] = ["active", "expired", "all"];

function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** True when the assignment deadline is within the next 5 days (or
 * already past) — these rows need attention soonest. */
function deadlineSoon(deadline: string | null): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  const fiveDays = 5 * 24 * 60 * 60 * 1000;
  return d.getTime() - Date.now() <= fiveDays;
}

export function ChannelOrphansPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { isPartnerApprover } = useRole();
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus>("active");

  const qk = ["orphans", { channel_id: id, assignment_status: statusFilter }] as const;

  const { data: channel } = useQuery({
    queryKey: ["marketing-channel", id],
    queryFn: () => getMarketingChannel(id),
    enabled: !!id,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: qk,
    queryFn: () =>
      listOrphans({ channel_id: id, assignment_status: statusFilter, limit: 100 }),
    enabled: !!id,
  });

  const release = useMutation({
    mutationFn: (orphanId: string) => releaseOrphan(orphanId),
    onSuccess: () => {
      toast.success(t("marketing.orphans.releaseDone"));
      qc.invalidateQueries({ queryKey: qk });
      qc.invalidateQueries({ queryKey: ["marketing-channel", id, "progress"] });
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError
          ? (err.response?.data?.detail ?? t("common.loadError"))
          : t("common.loadError");
      toast.error(msg);
    },
  });

  const channelName = channel
    ? i18n.language === "ar"
      ? channel.name_ar
      : channel.name_en ?? channel.name_ar
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {id && (
            <Link
              to={`/admin/marketing/channels/${id}`}
              className="text-sm text-trust underline"
            >
              ← {channelName || t("marketing.channel.eyebrow")}
            </Link>
          )}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("marketing.orphans.title")}
          </h1>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          {t("marketing.orphans.assignmentStatus")}
          <select
            className="input max-w-[12rem]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AssignmentStatus)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.orphans.statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <TableSkeleton columns={6} />}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-gray-500">{t("common.empty")}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <caption className="sr-only">{t("marketing.orphans.title")}</caption>
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-200">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("orphans.code")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("orphans.name")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("marketing.orphans.age")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("orphans.gender")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("marketing.orphans.deadline")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("orphans.caseStatus")}
                </th>
                {isPartnerApprover && <th scope="col" className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
              {data.items.map((o) => {
                const age = ageFromDob(o.date_of_birth);
                const soon = deadlineSoon(o.assignment_deadline);
                return (
                  <tr key={o.id} className="hover:bg-snow dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3 font-mono text-xs">{o.code}</td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                      {o.first_name} {o.family_name}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{age ?? "—"}</td>
                    <td className="px-4 py-3">
                      {o.gender === "M" ? t("orphans.male") : t("orphans.female")}
                    </td>
                    <td className="px-4 py-3">
                      {o.assignment_deadline ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs tabular-nums ${
                            soon
                              ? "bg-warning-100 font-medium text-warning-700"
                              : "text-gray-600 dark:text-gray-300"
                          }`}
                        >
                          {o.assignment_deadline.slice(0, 10)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CaseStatusBadge status={o.case_status} />
                    </td>
                    {isPartnerApprover && (
                      <td className="px-4 py-3 text-end">
                        <button
                          type="button"
                          className="rounded-lg border border-sky px-2 py-1 text-xs text-gray-700 hover:bg-tranquil disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                          onClick={() => release.mutate(o.id)}
                          disabled={release.isPending}
                        >
                          {t("marketing.orphans.release")}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CaseStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls =
    status === "approved" || status === "sponsored"
      ? "bg-success-100 text-success-700"
      : status === "reserved"
        ? "bg-info-100 text-info-700"
        : status === "pending_review"
          ? "bg-warning-100 text-warning-700"
          : "bg-gray-200 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {t(`orphans.caseStatus.${status}`, status)}
    </span>
  );
}
