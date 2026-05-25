import { useTranslation } from "react-i18next";

import { useCurrentUser } from "@/hooks/useCurrentUser";

export function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useCurrentUser();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("dashboard.title")}</h1>
      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("dashboard.accountInfo")}</h2>
        {isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
        {data && (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">{t("dashboard.name")}</dt>
              <dd className="font-medium text-slate-900">
                {data.first_name} {data.last_name}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("dashboard.email")}</dt>
              <dd className="font-medium text-slate-900">{data.email}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("dashboard.role")}</dt>
              <dd className="font-medium text-slate-900">{data.role}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("dashboard.organization")}</dt>
              <dd className="font-mono text-xs text-slate-600">{data.organization_id}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
