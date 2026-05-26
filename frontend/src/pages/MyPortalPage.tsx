import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { listDonors } from "@/lib/donors";
import { fetchMyReports, fetchMySponsorships } from "@/lib/donorPortal";

/**
 * Donor's-eye view of their own sponsorships + published reports.
 * Donors are pinned to themselves server-side. Staff/admin pick a
 * donor from the dropdown (the backend would 400 otherwise).
 */
export function MyPortalPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useCurrentUser();
  const { role } = useRole();
  const isStaff = role !== "donor" && role !== undefined;

  const { data: donorsPage } = useQuery({
    queryKey: ["donors", { limit: 100 }],
    queryFn: () => listDonors({ limit: 100 }),
    enabled: isStaff,
  });

  const [donorId, setDonorId] = useState<string>("");
  const effectiveDonorId = isStaff ? donorId || undefined : undefined;

  const sponsorshipsQ = useQuery({
    queryKey: ["me", "sponsorships", effectiveDonorId ?? "self"],
    queryFn: () => fetchMySponsorships(effectiveDonorId),
    enabled: !isStaff || !!effectiveDonorId,
  });
  const reportsQ = useQuery({
    queryKey: ["me", "reports", effectiveDonorId ?? "self"],
    queryFn: () => fetchMyReports(effectiveDonorId),
    enabled: !isStaff || !!effectiveDonorId,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t("portal.title")}
          </h1>
          {me && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {me.first_name} {me.last_name}
            </p>
          )}
        </div>
        {isStaff && (
          <select
            className="input max-w-sm"
            value={donorId}
            onChange={(e) => setDonorId(e.target.value)}
          >
            <option value="">{t("portal.selectDonor")}</option>
            {donorsPage?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {isStaff && !effectiveDonorId && (
        <p className="card text-center text-slate-500">{t("portal.pickDonorPrompt")}</p>
      )}

      {(!isStaff || effectiveDonorId) && (
        <>
          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">
              {t("portal.mySponsorships")}
            </h2>
            {sponsorshipsQ.isLoading && (
              <p className="text-slate-500">{t("common.loading")}</p>
            )}
            {sponsorshipsQ.data && sponsorshipsQ.data.items.length === 0 && (
              <p className="text-slate-500">{t("common.empty")}</p>
            )}
            {sponsorshipsQ.data && sponsorshipsQ.data.items.length > 0 && (
              <ul className="space-y-2 text-sm">
                {sponsorshipsQ.data.items.map((sp) => (
                  <li
                    key={sp.id}
                    className="flex items-center justify-between rounded-lg bg-snow px-3 py-2 dark:bg-slate-700"
                  >
                    <div>
                      <div className="font-mono text-xs text-slate-500">{sp.code}</div>
                      <div>
                        {sp.orphan_name ?? sp.orphan_id.slice(0, 8)} ·{" "}
                        <span className="text-slate-500">
                          {sp.monthly_amount} {sp.currency} /{" "}
                          {t(
                            `sponsorships.frequencies.${sp.payment_frequency}`,
                            sp.payment_frequency,
                          )}
                        </span>
                      </div>
                    </div>
                    <span className="rounded-md bg-tranquil px-2 py-0.5 text-xs font-medium uppercase dark:bg-slate-600">
                      {t(`sponsorships.statuses.${sp.status}`, sp.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2 className="mb-3 text-lg font-semibold">{t("portal.myReports")}</h2>
            {reportsQ.isLoading && (
              <p className="text-slate-500">{t("common.loading")}</p>
            )}
            {reportsQ.data && reportsQ.data.items.length === 0 && (
              <p className="text-slate-500">{t("portal.noReportsYet")}</p>
            )}
            {reportsQ.data && reportsQ.data.items.length > 0 && (
              <ul className="space-y-2 text-sm">
                {reportsQ.data.items.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg bg-snow px-3 py-2 dark:bg-slate-700"
                  >
                    <div className="flex items-center justify-between">
                      <span>
                        {t(`reports.types.${r.report_type}`, r.report_type)} ·{" "}
                        {r.period_start} → {r.period_end}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(r.updated_at).toLocaleDateString(i18n.language)}
                      </span>
                    </div>
                    {r.summary && (
                      <p className="mt-1 text-slate-700 dark:text-slate-300">{r.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
