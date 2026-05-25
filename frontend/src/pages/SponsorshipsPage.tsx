import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cancelSponsorship, listSponsorships } from "@/lib/sponsorships";

const SP_QUERY = ["sponsorships", { limit: 50, offset: 0 }] as const;

export function SponsorshipsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: SP_QUERY,
    queryFn: () => listSponsorships({ limit: 50, offset: 0 }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelSponsorship(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SP_QUERY }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("sponsorships.title")}
        </h1>
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
                <th className="px-4 py-3 font-medium">{t("sponsorships.code")}</th>
                <th className="px-4 py-3 font-medium">
                  {t("sponsorships.monthlyAmount")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("sponsorships.frequency")}
                </th>
                <th className="px-4 py-3 font-medium">{t("sponsorships.start")}</th>
                <th className="px-4 py-3 font-medium">
                  {t("sponsorships.nextPayment")}
                </th>
                <th className="px-4 py-3 font-medium">{t("sponsorships.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((s) => (
                <tr key={s.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                  <td className="px-4 py-3">
                    {s.monthly_amount} {s.currency}
                  </td>
                  <td className="px-4 py-3">
                    {t(`sponsorships.frequencies.${s.payment_frequency}`, s.payment_frequency)}
                  </td>
                  <td className="px-4 py-3">{s.start_date}</td>
                  <td className="px-4 py-3">{s.next_payment_date ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t(`sponsorships.statuses.${s.status}`, s.status)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {(s.status === "active" || s.status === "paused" || s.status === "overdue") && (
                      <button
                        type="button"
                        className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil"
                        onClick={() => cancelMut.mutate(s.id)}
                        disabled={cancelMut.isPending}
                      >
                        {t("sponsorships.cancel")}
                      </button>
                    )}
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
