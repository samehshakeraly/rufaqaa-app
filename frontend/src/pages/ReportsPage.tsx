import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  listReports,
  transitionReport,
  type Report,
  type ReportAction,
} from "@/lib/reports";

const QK = ["reports", { limit: 50, offset: 0 }] as const;

const NEXT_ACTION: Partial<Record<Report["status"], ReportAction>> = {
  draft: "submit",
  pending_partner_approval: "approve-partner",
  pending_org_approval: "approve-org",
  org_approved: "publish",
};

export function ReportsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listReports({ limit: 50 }),
  });
  const mut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ReportAction }) =>
      transitionReport(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t("reports.title")}</h1>
        {data && (
          <span className="text-sm text-slate-500">
            {t("common.total")}: {data.total.toLocaleString()}
          </span>
        )}
      </div>

      {isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-slate-500">{t("common.empty")}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
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
                return (
                  <tr key={r.id} className="hover:bg-snow">
                    <td className="px-4 py-3">
                      {t(`reports.types.${r.report_type}`, r.report_type)}
                    </td>
                    <td className="px-4 py-3">
                      {r.period_start} → {r.period_end}
                    </td>
                    <td className="px-4 py-3">
                      {t(`reports.statuses.${r.status}`, r.status)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {nextAction && (
                        <button
                          type="button"
                          className="rounded-lg border border-trust bg-trust px-2 py-1 text-xs text-white hover:bg-trust/90"
                          onClick={() => mut.mutate({ id: r.id, action: nextAction })}
                          disabled={mut.isPending}
                        >
                          {t(`reports.actions.${nextAction}`, nextAction)}
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
    </div>
  );
}
