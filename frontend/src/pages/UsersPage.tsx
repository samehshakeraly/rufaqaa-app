import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Pagination } from "@/components/Pagination";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { listUsers, reactivateUser, suspendUser } from "@/lib/users";
import { toast } from "@/store/toasts";

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
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const [offset, setOffset] = useState(0);
  const [role, setRole] = useState<string>("");

  useEffect(() => setOffset(0), [role]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["users", { limit: PAGE_SIZE, offset, role }],
    queryFn: () =>
      listUsers({ limit: PAGE_SIZE, offset, ...(role ? { role } : {}) }),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["users"], exact: false });

  const suspend = useMutation({
    mutationFn: (id: string) => suspendUser(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("users.suspended"));
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: () => {
      invalidate();
      toast.success(t("users.reactivated"));
    },
    onError: () => toast.error(t("common.createError")),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t("users.title")}
        </h1>
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
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-700/40 dark:text-slate-200">
              <tr>
                <th className="px-4 py-3 font-medium">{t("users.name")}</th>
                <th className="px-4 py-3 font-medium">{t("users.email")}</th>
                <th className="px-4 py-3 font-medium">{t("users.role")}</th>
                <th className="px-4 py-3 font-medium">{t("users.status")}</th>
                <th className="px-4 py-3 font-medium">{t("users.twofa")}</th>
                <th className="px-4 py-3 font-medium">{t("users.lastLogin")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm dark:divide-slate-700">
              {data.items.map((u) => {
                const isSelf = me?.id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-snow dark:hover:bg-slate-700">
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
                    <td className="px-4 py-3 text-end">
                      {!isSelf && u.status === "active" && (
                        <button
                          type="button"
                          className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                          onClick={() => suspend.mutate(u.id)}
                          disabled={suspend.isPending}
                        >
                          {t("users.suspend")}
                        </button>
                      )}
                      {!isSelf && u.status === "suspended" && (
                        <button
                          type="button"
                          className="rounded-lg border border-trust bg-trust px-2 py-1 text-xs text-white hover:bg-trust/90"
                          onClick={() => reactivate.mutate(u.id)}
                          disabled={reactivate.isPending}
                        >
                          {t("users.reactivate")}
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
