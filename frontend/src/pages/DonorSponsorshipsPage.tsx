import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { listMyDonorSponsorships } from "@/lib/donorAuth";

export function DonorSponsorshipsPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["donor", "me", "sponsorships"],
    queryFn: listMyDonorSponsorships,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        {t("donor.sponsorships.title")}
      </h1>

      {q.isLoading && <Skeleton className="h-40 w-full" />}

      {q.data?.length === 0 && (
        <div className="card text-center text-slate-500">
          <p>{t("donor.sponsorships.none")}</p>
          <Link to="/orphans" className="btn-primary mt-3 inline-block">
            {t("public.orphans.title")}
          </Link>
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start text-sm">
            <thead className="border-b border-sky bg-tranquil/40 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">
                  {t("donor.sponsorships.code")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("donor.sponsorships.orphan")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("donor.sponsorships.amount")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("donor.sponsorships.totalPaid")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("donor.sponsorships.status")}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40">
              {q.data.map((s) => (
                <tr key={s.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                  <td className="px-4 py-3">
                    {s.orphan_first_name ?? "—"}{" "}
                    {s.orphan_code && (
                      <span className="font-mono text-xs text-slate-500">
                        ({s.orphan_code})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {s.monthly_amount} {s.currency}
                  </td>
                  <td className="px-4 py-3">{s.total_paid}</td>
                  <td className="px-4 py-3">
                    {t(`sponsorships.statuses.${s.status}`, s.status)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {s.status === "pending" && s.orphan_code && (
                      <Link
                        to={`/sponsor/${s.orphan_code}/checkout`}
                        className="rounded-lg border border-trust bg-trust px-2 py-1 text-xs text-white hover:bg-trust/90"
                      >
                        {t("donor.sponsorships.pay")}
                      </Link>
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
