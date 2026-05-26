import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Pagination } from "@/components/Pagination";
import { listUsers } from "@/lib/users";

const PAGE_SIZE = 25;

const ROLE_OPTIONS = [
  "",
  "super_admin",
  "org_admin",
  "partner_manager",
  "partner_staff",
  "marketing_manager",
  "finance",
  "donor",
  "guardian",
  "viewer",
] as const;

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [role, setRole] = useState<string>("");

  useEffect(() => setOffset(0), [role]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["users", { limit: PAGE_SIZE, offset, role }],
    queryFn: () =>
      listUsers({ limit: PAGE_SIZE, offset, ...(role ? { role } : {}) }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("users.title")}</h1>
        <div className="flex items-center gap-4">
          <select
            className="input max-w-[12rem]"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === "" ? t("users.allRoles") : r}
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

      {data && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
        />
      )}

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
                <th className="px-4 py-3 font-medium">{t("users.name")}</th>
                <th className="px-4 py-3 font-medium">{t("users.email")}</th>
                <th className="px-4 py-3 font-medium">{t("users.role")}</th>
                <th className="px-4 py-3 font-medium">{t("users.status")}</th>
                <th className="px-4 py-3 font-medium">{t("users.twofa")}</th>
                <th className="px-4 py-3 font-medium">{t("users.lastLogin")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((u) => (
                <tr key={u.id} className="hover:bg-snow">
                  <td className="px-4 py-3">
                    {u.first_name} {u.last_name}
                  </td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.role}</td>
                  <td className="px-4 py-3">{u.status}</td>
                  <td className="px-4 py-3">
                    {u.two_factor_enabled ? "✓" : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleString(i18n.language)
                      : "—"}
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
