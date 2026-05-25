import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listPayments } from "@/lib/payments";

export function PaymentsPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["payments", { limit: 50 }],
    queryFn: () => listPayments({ limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t("payments.title")}</h1>
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
                <th className="px-4 py-3 font-medium">{t("payments.code")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.amount")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.method")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.gateway")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.status")}</th>
                <th className="px-4 py-3 font-medium">{t("payments.completedAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((p) => (
                <tr key={p.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3">
                    {p.amount} {p.currency}
                  </td>
                  <td className="px-4 py-3">
                    {t(`payments.methods.${p.payment_method}`, p.payment_method)}
                  </td>
                  <td className="px-4 py-3">{p.payment_gateway ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t(`payments.statuses.${p.status}`, p.status)}
                  </td>
                  <td className="px-4 py-3">
                    {p.completed_at ? p.completed_at.slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
