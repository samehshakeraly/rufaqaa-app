import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { OrgStatusBadge } from "@/components/OrgStatusBadge";
import { TableSkeleton } from "@/components/Skeleton";
import {
  activatePlatformOrganization,
  createPlatformOrganization,
  DEPLOYMENT_MODES,
  ORG_STATUSES,
  ORG_TYPES,
  suspendPlatformOrganization,
  updatePlatformOrganization,
  type DeploymentMode,
  type OrgStatus,
  type OrgType,
  type PlatformOrgSummary,
  listPlatformOrganizations,
} from "@/lib/platform";
import { toast } from "@/store/toasts";

export function PlatformOrganizationsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isAr = i18n.language.startsWith("ar");

  const [status, setStatus] = useState("");
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PlatformOrgSummary | null>(null);
  const [suspending, setSuspending] = useState<PlatformOrgSummary | null>(null);
  const [activating, setActivating] = useState<PlatformOrgSummary | null>(null);

  const params = {
    ...(status ? { status } : {}),
    ...(country.trim() ? { country: country.trim() } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform", "organizations", params],
    queryFn: () => listPlatformOrganizations(params),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["platform"], exact: false });

  const nfmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t("platform.orgs.title")}
        </h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowCreate(true)}
        >
          {t("platform.orgs.add")}
        </button>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("platform.orgs.filters.status")}
          </span>
          <select
            className="input max-w-[12rem]"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("platform.orgs.filters.allStatuses")}</option>
            {ORG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`platform.orgStatus.${s}`, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("platform.orgs.filters.country")}
          </span>
          <input
            className="input max-w-[8rem]"
            placeholder="KW"
            maxLength={2}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("platform.orgs.filters.search")}
          </span>
          <input
            className="input"
            placeholder={t("platform.orgs.filters.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {data && (
          <span className="pb-2 text-sm text-slate-500">
            {t("common.total")}: <span className="tabular-nums">{data.length}</span>
          </span>
        )}
      </div>

      {isLoading && <TableSkeleton columns={8} />}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}
      {data && data.length === 0 && (
        <div className="card text-center text-slate-500">{t("common.empty")}</div>
      )}

      {data && data.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <caption className="sr-only">{t("platform.orgs.title")}</caption>
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700 dark:border-gray-700 dark:bg-gray-700/40 dark:text-slate-200">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">{t("platform.orgs.cols.code")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("platform.orgs.cols.name")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("platform.orgs.cols.country")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("platform.orgs.cols.status")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("platform.orgs.cols.plan")}</th>
                <th scope="col" className="px-4 py-3 text-end font-medium">{t("platform.orgs.cols.orphans")}</th>
                <th scope="col" className="px-4 py-3 text-end font-medium">{t("platform.orgs.cols.donors")}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t("platform.orgs.cols.createdAt")}</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t("platform.orgs.cols.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
              {data.map((org) => (
                <tr key={org.id} className="hover:bg-snow dark:hover:bg-gray-700">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {org.code}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">
                    {isAr ? org.name_ar : org.name_en}
                  </td>
                  <td className="px-4 py-3">{org.country_code}</td>
                  <td className="px-4 py-3">
                    <OrgStatusBadge status={org.status} />
                  </td>
                  <td className="px-4 py-3">{org.subscription_plan ?? "—"}</td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {nfmt.format(org.total_orphans)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {nfmt.format(org.total_donors)}
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums text-slate-500">
                    {new Date(org.created_at).toLocaleDateString(i18n.language)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil dark:border-gray-600 dark:text-slate-200 dark:hover:bg-gray-700"
                        onClick={() => setEditing(org)}
                      >
                        {t("platform.orgs.edit")}
                      </button>
                      {org.status === "suspended" ? (
                        <button
                          type="button"
                          className="rounded-lg border border-success-500 bg-success-50 px-2 py-1 text-xs text-success-700 hover:bg-success-100"
                          onClick={() => setActivating(org)}
                        >
                          {t("platform.orgs.activate")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded-lg border border-danger-500 px-2 py-1 text-xs text-danger-700 hover:bg-danger-50"
                          onClick={() => setSuspending(org)}
                        >
                          {t("platform.orgs.suspend")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            await invalidate();
            setShowCreate(false);
          }}
        />
      )}
      {editing && (
        <EditOrgModal
          org={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await invalidate();
            setEditing(null);
          }}
        />
      )}
      {suspending && (
        <SuspendDialog
          org={suspending}
          onClose={() => setSuspending(null)}
          onDone={async () => {
            await invalidate();
            setSuspending(null);
          }}
        />
      )}
      {activating && (
        <ActivateDialog
          org={activating}
          onClose={() => setActivating(null)}
          onDone={async () => {
            await invalidate();
            setActivating(null);
          }}
        />
      )}
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-snow dark:hover:bg-gray-700"
            aria-label={title}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const d = err.response?.data?.detail;
    if (typeof d === "string") return d;
  }
  return fallback;
}

// ── Create org ───────────────────────────────────────────────────────

function CreateOrgModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [countryCode, setCountryCode] = useState("KW");
  const [currency, setCurrency] = useState("KWD");
  const [orgType, setOrgType] = useState<OrgType>("standalone");
  const [deployment, setDeployment] = useState<DeploymentMode>("self_hosted");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFirst, setAdminFirst] = useState("Org");
  const [adminLast, setAdminLast] = useState("Admin");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      createPlatformOrganization({
        code: code.trim(),
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        country_code: countryCode.trim(),
        default_currency: currency.trim(),
        org_type: orgType,
        deployment_mode: deployment,
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
        admin_first_name: adminFirst.trim(),
        admin_last_name: adminLast.trim(),
      }),
    onSuccess: async (res) => {
      toast.success(t("platform.orgs.create.created", { email: res.admin_user.email }));
      await onCreated();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("platform.orgs.create.title")} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("platform.orgs.create.code")}>
            <input
              required
              minLength={2}
              maxLength={20}
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label={t("platform.orgs.create.country")}>
            <input
              required
              maxLength={2}
              className="input"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t("platform.orgs.create.nameAr")}>
            <input
              required
              className="input"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </Field>
          <Field label={t("platform.orgs.create.nameEn")}>
            <input
              required
              className="input"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </Field>
          <Field label={t("platform.orgs.create.currency")}>
            <input
              required
              maxLength={3}
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t("platform.orgs.create.orgType")}>
            <select
              className="input"
              value={orgType}
              onChange={(e) => setOrgType(e.target.value as OrgType)}
            >
              {ORG_TYPES.map((o) => (
                <option key={o} value={o}>
                  {t(`platform.orgType.${o}`, o)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("platform.orgs.create.deployment")}>
            <select
              className="input"
              value={deployment}
              onChange={(e) => setDeployment(e.target.value as DeploymentMode)}
            >
              {DEPLOYMENT_MODES.map((d) => (
                <option key={d} value={d}>
                  {t(`platform.deployment.${d}`, d)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="space-y-4 rounded-xl border border-sky p-4 dark:border-gray-700">
          <legend className="px-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {t("platform.orgs.create.adminLegend")}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("platform.orgs.create.adminEmail")}>
              <input
                type="email"
                required
                className="input"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </Field>
            <Field label={t("platform.orgs.create.adminPassword")}>
              <input
                type="password"
                required
                minLength={8}
                className="input"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </Field>
            <Field label={t("platform.orgs.create.adminFirst")}>
              <input
                required
                className="input"
                value={adminFirst}
                onChange={(e) => setAdminFirst(e.target.value)}
              />
            </Field>
            <Field label={t("platform.orgs.create.adminLast")}>
              <input
                required
                className="input"
                value={adminLast}
                onChange={(e) => setAdminLast(e.target.value)}
              />
            </Field>
          </div>
        </fieldset>

        {serverError && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {serverError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil dark:border-gray-600 dark:text-slate-200 dark:hover:bg-gray-700"
            onClick={onClose}
            disabled={mut.isPending}
          >
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("platform.orgs.create.submit")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Edit org ─────────────────────────────────────────────────────────

function EditOrgModal({
  org,
  onClose,
  onSaved,
}: {
  org: PlatformOrgSummary;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [status, setStatus] = useState<OrgStatus>(org.status as OrgStatus);
  const [plan, setPlan] = useState(org.subscription_plan ?? "");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      updatePlatformOrganization(org.id, {
        status,
        subscription_plan: plan.trim() ? plan.trim() : null,
      }),
    onSuccess: async () => {
      toast.success(t("platform.orgs.edit.saved"));
      await onSaved();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell
      title={`${t("platform.orgs.edit")} — ${isAr ? org.name_ar : org.name_en}`}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
      >
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">{t("platform.orgs.cols.code")}</dt>
          <dd className="font-mono text-xs text-slate-700 dark:text-slate-200">{org.code}</dd>
          <dt className="text-slate-500">{t("platform.orgs.cols.country")}</dt>
          <dd className="text-slate-700 dark:text-slate-200">{org.country_code}</dd>
        </dl>

        <Field label={t("platform.orgs.cols.status")}>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as OrgStatus)}
          >
            {ORG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`platform.orgStatus.${s}`, s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("platform.orgs.cols.plan")}>
          <input
            className="input"
            value={plan}
            placeholder={t("platform.orgs.edit.planPlaceholder")}
            onChange={(e) => setPlan(e.target.value)}
          />
        </Field>

        {serverError && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {serverError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil dark:border-gray-600 dark:text-slate-200 dark:hover:bg-gray-700"
            onClick={onClose}
            disabled={mut.isPending}
          >
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Suspend (destructive — requires reason + confirm) ────────────────

function SuspendDialog({
  org,
  onClose,
  onDone,
}: {
  org: PlatformOrgSummary;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => suspendPlatformOrganization(org.id, reason.trim()),
    onSuccess: async () => {
      toast.success(t("platform.orgs.suspendDialog.done"));
      await onDone();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("platform.orgs.suspendDialog.title")} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("platform.orgs.suspendDialog.body", {
          name: isAr ? org.name_ar : org.name_en,
        })}
      </p>
      <Field label={t("platform.orgs.suspendDialog.reason")}>
        <textarea
          required
          rows={3}
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {serverError && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {serverError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil dark:border-gray-600 dark:text-slate-200 dark:hover:bg-gray-700"
          onClick={onClose}
          disabled={mut.isPending}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50"
          onClick={() => {
            setServerError(null);
            if (reason.trim()) mut.mutate();
          }}
          disabled={mut.isPending || !reason.trim()}
        >
          {mut.isPending ? t("common.saving") : t("platform.orgs.suspend")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Activate (confirm) ───────────────────────────────────────────────

function ActivateDialog({
  org,
  onClose,
  onDone,
}: {
  org: PlatformOrgSummary;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => activatePlatformOrganization(org.id),
    onSuccess: async () => {
      toast.success(t("platform.orgs.activateDialog.done"));
      await onDone();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("platform.orgs.activateDialog.title")} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("platform.orgs.activateDialog.body", {
          name: isAr ? org.name_ar : org.name_en,
        })}
      </p>
      {serverError && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {serverError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil dark:border-gray-600 dark:text-slate-200 dark:hover:bg-gray-700"
          onClick={onClose}
          disabled={mut.isPending}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setServerError(null);
            mut.mutate();
          }}
          disabled={mut.isPending}
        >
          {mut.isPending ? t("common.saving") : t("platform.orgs.activate")}
        </button>
      </div>
    </ModalShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {children}
    </label>
  );
}
