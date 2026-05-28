import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import {
  listReports,
  transitionReport,
  type ReportAction,
  type ReportStatus,
} from "@/lib/reports";
import { toast } from "@/store/toasts";

const QK = ["reports", { limit: 50, offset: 0 }] as const;

// Full org workflow: submit → partner approval → org approval → publish.
// Reject is paired separately as a secondary action button below.
const ADMIN_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
  pending_partner_approval: "approve-partner",
  pending_org_approval: "approve-org",
  org_approved: "publish",
};

// UI gate only — backend currently allows any authenticated org user
// (see reports.py docstring). Partner managers see submit + partner
// approve + reject paths but org-stage transitions are hidden.
const PARTNER_MANAGER_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
  pending_partner_approval: "approve-partner",
};

// UI gate only — backend currently allows any authenticated org user
// (see reports.py docstring). Partner staff can only submit a draft;
// approval rests with the manager.
const PARTNER_STAFF_NEXT_ACTION: Partial<Record<ReportStatus, ReportAction>> = {
  draft: "submit",
};

// Statuses where the current viewer may reject. Mirrors the primary
// transition map above — only roles that can advance the workflow get
// a reject button.
function rejectableStatuses(map: Partial<Record<ReportStatus, ReportAction>>): Set<ReportStatus> {
  return new Set(Object.keys(map) as ReportStatus[]);
}

export function ReportsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin, isPartnerApprover, isPartnerStaff } = useRole();
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const NEXT_ACTION = useMemo<Partial<Record<ReportStatus, ReportAction>>>(() => {
    if (isAdmin) return ADMIN_NEXT_ACTION;
    if (isPartnerApprover) return PARTNER_MANAGER_NEXT_ACTION;
    if (isPartnerStaff) return PARTNER_STAFF_NEXT_ACTION;
    // Finance / marketing_manager / donor / viewer: no transition affordances.
    return {};
  }, [isAdmin, isPartnerApprover, isPartnerStaff]);

  const rejectable = useMemo(() => rejectableStatuses(NEXT_ACTION), [NEXT_ACTION]);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listReports({ limit: 50 }),
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("reports.title")}</h1>
        {data && (
          <span className="text-sm text-gray-500">
            {t("common.total")}: {data.total.toLocaleString()}
          </span>
        )}
      </div>

      {isLoading && <TableSkeleton columns={5} />}
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
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-gray-700">
              <tr>
                <th className="px-4 py-3 font-medium">{t("reports.type")}</th>
                <th className="px-4 py-3 font-medium">{t("reports.period")}</th>
                <th className="px-4 py-3 font-medium">{t("reports.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((r) => {
                const nextAction = NEXT_ACTION[r.status];
                const canReject = rejectable.has(r.status);
                return (
                  <tr key={r.id} className="hover:bg-snow">
                    <td className="px-4 py-3">
                      {t(`reports.types.${r.report_type}`, r.report_type)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {r.period_start} → {r.period_end}
                    </td>
                    <td className="px-4 py-3">
                      {t(`reports.statuses.${r.status}`, r.status)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        to={`/admin/reports/${r.id}`}
                        className="me-2 rounded-lg border border-sky px-2 py-1 text-xs text-gray-700 hover:bg-tranquil"
                      >
                        {t("reports.open")}
                      </Link>
                      {nextAction && (
                        <button
                          type="button"
                          aria-label={t(`reports.actions.${nextAction}`, nextAction)}
                          className="me-2 rounded-lg border border-trust bg-trust-500 px-2 py-1 text-xs text-white hover:bg-trust-600 disabled:opacity-50"
                          onClick={() => mut.mutate({ id: r.id, action: nextAction })}
                          disabled={mut.isPending}
                        >
                          {t(`reports.actions.${nextAction}`, nextAction)}
                        </button>
                      )}
                      {canReject && (
                        <button
                          type="button"
                          aria-label={t("reports.actions.reject")}
                          className="rounded-lg bg-danger-600 px-2 py-1 text-xs text-white hover:bg-danger-700 disabled:opacity-50"
                          onClick={() => setRejectingId(r.id)}
                          disabled={rejectMut.isPending}
                        >
                          {t("reports.actions.reject")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejectingId && (
        <ReasonDialog
          title={t("reports.actions.rejectReason")}
          placeholder={t("orphans.actions.rejectReasonPlaceholder")}
          submitLabel={t("reports.actions.rejectSubmit")}
          isSubmitting={rejectMut.isPending}
          onCancel={() => setRejectingId(null)}
          onSubmit={(reason) => rejectMut.mutate({ id: rejectingId, reason })}
        />
      )}
    </div>
  );
}

interface ReasonDialogProps {
  title: string;
  placeholder: string;
  submitLabel: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

function ReasonDialog({
  title,
  placeholder,
  submitLabel,
  isSubmitting,
  onCancel,
  onSubmit,
}: ReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      setError(t("common.required"));
      return;
    }
    setError(null);
    onSubmit(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <textarea
          className="input"
          rows={4}
          autoFocus
          maxLength={1000}
          placeholder={placeholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-gray-700 hover:bg-tranquil"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-danger-600 px-3 py-1 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? t("common.saving") : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
