import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { Pagination } from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  inviteUser,
  listUsers,
  reactivateUser,
  suspendUser,
  type UserInviteResult,
} from "@/lib/users";
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

// Roles an org admin may *invite* as staff. super_admin is bootstrap-only,
// donor self-signs up, guardian is system-internal.
const INVITABLE_ROLES = [
  "org_admin",
  "partner_manager",
  "partner_staff",
  "marketing_manager",
  "finance",
  "viewer",
] as const;

type InvitableRole = (typeof INVITABLE_ROLES)[number];

function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}

function isAllowedRoleFilter(value: string): boolean {
  return (ROLE_OPTIONS as readonly string[]).includes(value);
}

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  // Clamp ?role= to the known option list so a hand-edited URL can't
  // smuggle an unrecognised value into the query / state.
  const rawUrlRole = searchParams.get("role") ?? "";
  const urlRole = isAllowedRoleFilter(rawUrlRole) ? rawUrlRole : "";

  const [offset, setOffset] = useState(0);
  const [role, setRole] = useState<string>(urlRole);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteResult, setInviteResult] = useState<UserInviteResult | null>(null);

  // Mirror URL → local state when navigation updates ?role=.
  useEffect(() => {
    setRole(urlRole);
  }, [urlRole]);

  useEffect(() => setOffset(0), [role]);

  function onRoleChange(next: string) {
    setRole(next);
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("role", next);
    else sp.delete("role");
    setSearchParams(sp, { replace: true });
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["users", { limit: PAGE_SIZE, offset, role }],
    queryFn: () =>
      listUsers({ limit: PAGE_SIZE, offset, ...(role ? { role } : {}) }),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["users"], exact: false });

  const suspend = useMutation({
    mutationFn: (id: string) => suspendUser(id),
    onSuccess: async () => {
      await invalidate();
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
    onSuccess: async () => {
      await invalidate();
      toast.success(t("users.reactivated"));
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  const isStaffView = role === "partner_staff";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {isStaffView ? t("users.staff.title") : t("users.title")}
        </h1>
        <div className="flex items-center gap-4">
          <select
            className="input max-w-[12rem]"
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === "" ? t("users.allRoles") : t(`users.roles.${r}`, r)}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-sm text-gray-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setShowInvite((v) => !v);
              setInviteResult(null);
            }}
          >
            {showInvite ? t("common.cancel") : t("users.staff.invite")}
          </button>
        </div>
      </div>

      {showInvite && (
        <InviteUserForm
          defaultRole={isInvitableRole(role) ? role : "partner_staff"}
          onInvited={async (result) => {
            setInviteResult(result);
            await invalidate();
          }}
        />
      )}

      {inviteResult && (
        <div className="card space-y-2 border border-success-500 bg-success-50">
          <p className="text-sm font-medium text-success-700">
            {t("users.staff.invitePartnerStaff")}: {inviteResult.user.email}
          </p>
          <code className="block break-all rounded bg-white px-3 py-2 font-mono text-xs text-gray-700">
            {inviteResult.invite_token}
          </code>
        </div>
      )}

      {data && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
        />
      )}

      {isLoading && <TableSkeleton columns={7} />}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-gray-500">{t("common.empty")}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-700/40 dark:text-gray-200">
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
            <tbody className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
              {data.items.map((u) => {
                const isSelf = me?.id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-snow dark:hover:bg-gray-700">
                    <td className="px-4 py-3">
                      {u.first_name} {u.last_name}
                    </td>
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3">{t(`users.roles.${u.role}`, u.role)}</td>
                    <td className="px-4 py-3">{u.status}</td>
                    <td className="px-4 py-3">
                      {u.two_factor_enabled ? "✓" : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleString(i18n.language)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-end">
                      {!isSelf && u.status === "active" && (
                        <button
                          type="button"
                          className="rounded-lg border border-sky px-2 py-1 text-xs text-gray-700 hover:bg-tranquil dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                          onClick={() => suspend.mutate(u.id)}
                          disabled={suspend.isPending}
                        >
                          {t("users.suspend")}
                        </button>
                      )}
                      {!isSelf && u.status === "suspended" && (
                        <button
                          type="button"
                          className="rounded-lg border border-trust bg-trust-500 px-2 py-1 text-xs text-white hover:bg-trust-600"
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

interface InviteUserFormProps {
  defaultRole: InvitableRole;
  onInvited: (result: UserInviteResult) => void | Promise<void>;
}

function InviteUserForm({ defaultRole, onInvited }: InviteUserFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole>(defaultRole);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    setInviteRole(defaultRole);
  }, [defaultRole]);

  const mut = useMutation({
    mutationFn: () =>
      inviteUser({
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role: inviteRole,
      }),
    onSuccess: async (result) => {
      setEmail("");
      setFirstName("");
      setLastName("");
      setServerError(null);
      await onInvited(result);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      setServerError(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  return (
    <form
      className="card space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t("users.email")}
          </span>
          <input
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t("users.role")}
          </span>
          <select
            className="input"
            value={inviteRole}
            onChange={(e) => {
              const next = e.target.value;
              if (isInvitableRole(next)) setInviteRole(next);
            }}
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`users.roles.${r}`, r)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t("orphans.firstName")}
          </span>
          <input
            required
            className="input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t("orphans.familyName")}
          </span>
          <input
            required
            className="input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </label>
      </div>

      {serverError && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {serverError}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={mut.isPending}>
        {mut.isPending ? t("common.saving") : t("users.staff.invite")}
      </button>
    </form>
  );
}
