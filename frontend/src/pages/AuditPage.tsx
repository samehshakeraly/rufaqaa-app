import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { listAudit } from "@/lib/audit";

const ENTITY_TYPES = ["", "donor", "orphan", "partner_organization", "media", "guardian", "family"];

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [entityType, setEntityType] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", { entity_type: entityType }],
    queryFn: () =>
      listAudit({
        limit: 100,
        ...(entityType ? { entity_type: entityType } : {}),
      }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("audit.title")}</h1>
        <div className="flex items-center gap-4">
          <select
            className="input max-w-xs"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          >
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et === "" ? t("audit.allTypes") : et}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
        </div>
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
                <th className="px-4 py-3 font-medium">{t("audit.when")}</th>
                <th className="px-4 py-3 font-medium">{t("audit.action")}</th>
                <th className="px-4 py-3 font-medium">{t("audit.entity")}</th>
                <th className="px-4 py-3 font-medium">{t("audit.entityId")}</th>
                <th className="px-4 py-3 font-medium">{t("audit.details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((e) => (
                <tr
                  key={e.id}
                  className={e.is_sensitive ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-snow"}
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {new Date(e.created_at).toLocaleString(i18n.language)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
                  <td className="px-4 py-3">{e.entity_type}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {e.entity_id?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {summarize(e.new_values ?? e.old_values)}
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

function summarize(v: Record<string, unknown> | null): string {
  if (!v) return "—";
  const entries = Object.entries(v).slice(0, 3);
  return entries.map(([k, val]) => `${k}=${JSON.stringify(val)}`).join(", ");
}
