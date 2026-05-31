import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import {
  getDonorMe,
  listMyDonorPayments,
  listMyDonorSponsorships,
} from "@/lib/donorAuth";

export function DonorDashboardPage() {
  const { t } = useTranslation();
  const { data: me } = useCurrentUser();
  // Donor self-service endpoints 403 for any non-donor role. DonorRoute
  // already redirects staff away, but gate the queries on role too so a
  // /donor/* request can never fire during a role transition (e.g. an
  // org_admin briefly mounting this tree).
  const { isDonor } = useRole();
  const profile = useQuery({
    queryKey: ["donor", "me"],
    queryFn: getDonorMe,
    enabled: isDonor,
  });
  const sponsorships = useQuery({
    queryKey: ["donor", "me", "sponsorships"],
    queryFn: listMyDonorSponsorships,
    enabled: isDonor,
  });
  const payments = useQuery({
    queryKey: ["donor", "me", "payments"],
    queryFn: listMyDonorPayments,
    enabled: isDonor,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        {t("donor.dashboard.welcome", { name: me?.first_name ?? "" })}
      </h1>

      {!profile.data && <Skeleton className="h-20 w-full" />}
      {profile.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label={t("donor.dashboard.activeSponsorships")}
            value={profile.data.active_sponsorships}
          />
          <Stat
            label={t("donor.dashboard.totalSponsorships")}
            value={profile.data.total_sponsorships}
          />
          <Stat
            label={t("donor.dashboard.totalDonated")}
            value={`${profile.data.total_donated} ${profile.data.preferred_currency ?? ""}`}
          />
        </div>
      )}

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("donor.dashboard.sponsorshipsHeader")}
          </h2>
          <Link to="/donor/sponsorships" className="text-sm text-trust underline">
            {t("donor.dashboard.viewAll")}
          </Link>
        </div>
        {sponsorships.data?.length === 0 && (
          <p className="text-sm text-slate-500">
            {t("donor.dashboard.noSponsorshipsYet")}{" "}
            <Link to="/orphans" className="text-trust underline">
              {t("donor.dashboard.browseNow")}
            </Link>
          </p>
        )}
        {sponsorships.data && sponsorships.data.length > 0 && (
          <ul className="divide-y divide-sky/40 text-sm">
            {sponsorships.data.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono text-xs text-slate-500">
                    {s.code}
                  </span>{" "}
                  · {s.orphan_first_name ?? "—"}
                </span>
                <span className="text-xs">
                  {s.monthly_amount} {s.currency} · {s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">
          {t("donor.dashboard.recentPayments")}
        </h2>
        {payments.data?.length === 0 && (
          <p className="text-sm text-slate-500">{t("common.empty")}</p>
        )}
        {payments.data && payments.data.length > 0 && (
          <ul className="divide-y divide-sky/40 text-sm">
            {payments.data.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span className="font-mono text-xs text-slate-500">{p.code}</span>
                <span>
                  {p.amount} {p.currency}
                </span>
                <span className="text-xs text-slate-500">{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
