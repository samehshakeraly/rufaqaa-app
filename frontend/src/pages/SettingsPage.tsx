import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";

import { OrganizationSettingsCard } from "@/components/OrganizationSettingsCard";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { api } from "@/lib/api";
import {
  type NotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/auth";
import { disable2FA, enroll2FA, verify2FA } from "@/lib/twofa";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toasts";

type TabId =
  | "myAccount"
  | "organization"
  | "businessRules"
  | "integrations"
  | "danger";

interface TabDef {
  id: TabId;
  labelKey: string;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "myAccount", labelKey: "settings.tabs.myAccount" },
  { id: "organization", labelKey: "settings.tabs.organization", adminOnly: true },
  { id: "businessRules", labelKey: "settings.tabs.businessRules", adminOnly: true },
  { id: "integrations", labelKey: "settings.tabs.integrations", adminOnly: true },
  { id: "danger", labelKey: "settings.tabs.danger", adminOnly: true },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const { isAdmin } = useRole();
  const [params, setParams] = useSearchParams();

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => !tab.adminOnly || isAdmin),
    [isAdmin],
  );

  const rawActive = params.get("tab") as TabId | null;
  const fallback = visibleTabs[0]?.id ?? "myAccount";
  const active: TabId =
    rawActive && visibleTabs.some((t) => t.id === rawActive)
      ? rawActive
      : fallback;

  function setActive(next: TabId) {
    const sp = new URLSearchParams(params);
    sp.set("tab", next);
    setParams(sp, { replace: true });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {t("settings.title")}
      </h1>

      <div
        role="tablist"
        aria-label={t("settings.title")}
        className="flex flex-wrap gap-1 border-b border-sky-200 dark:border-gray-700"
      >
        {visibleTabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`settings-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-trust-500 text-trust-700"
                  : "border-transparent text-gray-600 hover:text-trust-700 dark:text-gray-300"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
        className="space-y-6"
      >
        {active === "myAccount" && <MyAccountTab />}
        {active === "organization" && isAdmin && <OrganizationProfileTab />}
        {active === "businessRules" && isAdmin && <BusinessRulesTab />}
        {active === "integrations" && isAdmin && <IntegrationsTab />}
        {active === "danger" && isAdmin && <DangerZoneTab />}
      </section>
    </div>
  );
}

// ─── My Account ──────────────────────────────────────────────────────────────

function MyAccountTab() {
  return (
    <>
      <ChangePasswordCard />
      <TwoFASection />
      <NotificationPreferencesCard />
    </>
  );
}

function buildPasswordSchema(t: (k: string) => string) {
  return z
    .object({
      current_password: z.string().min(1, t("common.required")),
      new_password: z.string().min(8, t("auth.passwordTooShort")),
      confirm_password: z.string().min(1, t("common.required")),
    })
    .refine((v) => v.new_password === v.confirm_password, {
      path: ["confirm_password"],
      message: "passwords do not match",
    });
}

type PasswordFormValues = z.infer<ReturnType<typeof buildPasswordSchema>>;

function ChangePasswordCard() {
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(buildPasswordSchema(t)),
  });

  const mut = useMutation({
    mutationFn: (v: PasswordFormValues) =>
      api.post("/auth/change-password", {
        current_password: v.current_password,
        new_password: v.new_password,
      }),
    onSuccess: () => {
      setSuccess(true);
      setServerError(null);
      reset();
      setTimeout(() => clear(), 1500);
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  return (
    <form
      onSubmit={handleSubmit((v) => {
        setSuccess(false);
        mut.mutate(v);
      })}
      className="card max-w-lg space-y-4"
    >
      <h2 className="text-lg font-semibold">{t("settings.changePassword")}</h2>

      <Field
        label={t("settings.currentPassword")}
        error={errors.current_password?.message}
      >
        <input
          type="password"
          className="input"
          autoComplete="current-password"
          {...register("current_password")}
        />
      </Field>
      <Field
        label={t("settings.newPassword")}
        error={errors.new_password?.message}
      >
        <input
          type="password"
          className="input"
          autoComplete="new-password"
          {...register("new_password")}
        />
      </Field>
      <Field
        label={t("settings.confirmPassword")}
        error={errors.confirm_password?.message}
      >
        <input
          type="password"
          className="input"
          autoComplete="new-password"
          {...register("confirm_password")}
        />
      </Field>

      {serverError && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {serverError}
        </p>
      )}
      {success && (
        <p className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">
          {t("settings.changedSuccess")}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={isSubmitting}>
        {isSubmitting ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

function NotificationPreferencesCard() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const prefs = user?.notification_preferences;

  const mut = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      updateNotificationPreferences(patch),
    onSuccess: () => toast.success(t("settings.notificationsSaved")),
    onError: () => toast.error(t("common.createError")),
  });

  if (!prefs) {
    return (
      <div className="card max-w-lg">
        <p className="text-sm text-gray-500">{t("common.loading")}</p>
      </div>
    );
  }

  const channels: Array<keyof NotificationPreferences> = [
    "email",
    "sms",
    "whatsapp",
    "weekly_digest",
    "marketing",
  ];

  return (
    <div className="card max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">{t("settings.notifications")}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t("settings.notificationsDescription")}
      </p>
      <div className="space-y-2">
        {channels.map((c) => (
          <label
            key={c}
            className="flex items-center justify-between rounded-lg border border-sky-200 px-3 py-2 dark:border-gray-700"
          >
            <span className="text-sm text-gray-700 dark:text-gray-200">
              {t(`settings.channels.${c}`)}
            </span>
            <input
              type="checkbox"
              checked={prefs[c]}
              onChange={(e) => mut.mutate({ [c]: e.target.checked })}
              disabled={mut.isPending}
              className="h-4 w-4"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function TwoFASection() {
  const { t } = useTranslation();
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const enroll = useMutation({
    mutationFn: enroll2FA,
    onSuccess: (data) =>
      setEnrollment({ secret: data.secret, uri: data.otpauth_uri }),
    onError: (err) => {
      if (err instanceof AxiosError)
        toast.error(err.response?.data?.detail ?? "2FA failed");
    },
  });
  const verify = useMutation({
    mutationFn: (c: string) => verify2FA(c),
    onSuccess: (data) => {
      setBackupCodes(data.backup_codes);
      setEnrollment(null);
      setCode("");
      toast.success(t("settings.twofaEnabled"));
    },
    onError: () => toast.error(t("settings.twofaInvalidCode")),
  });
  const disable = useMutation({
    mutationFn: (c: string) => disable2FA(c),
    onSuccess: () => {
      setBackupCodes(null);
      setCode("");
      toast.success(t("settings.twofaDisabled"));
    },
    onError: () => toast.error(t("settings.twofaInvalidCode")),
  });

  return (
    <div className="card max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">{t("settings.twofa")}</h2>

      {!enrollment && !backupCodes && (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("settings.twofaDescription")}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => enroll.mutate()}
            disabled={enroll.isPending}
          >
            {t("settings.twofaEnroll")}
          </button>
        </>
      )}

      {enrollment && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {t("settings.twofaScanInstruction")}
          </p>
          <pre className="overflow-x-auto rounded-lg bg-snow p-3 text-xs">
            {enrollment.uri}
          </pre>
          <p className="text-sm">
            {t("settings.twofaSecret")}:{" "}
            <code className="rounded bg-snow px-2 py-1 font-mono text-xs">
              {enrollment.secret}
            </code>
          </p>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => verify.mutate(code)}
              disabled={code.length < 6 || verify.isPending}
            >
              {t("settings.twofaVerify")}
            </button>
          </div>
        </div>
      )}

      {backupCodes && (
        <div className="space-y-3">
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
            {t("settings.twofaBackupWarning")}
          </p>
          <pre className="grid grid-cols-2 gap-1 rounded-lg bg-snow p-3 font-mono text-xs tabular-nums">
            {backupCodes.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </pre>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
            />
            <button
              type="button"
              className="rounded-lg border border-sky-200 px-3 py-2 text-sm text-gray-700 hover:bg-tranquil-100 dark:border-gray-700 dark:text-gray-200"
              onClick={() => disable.mutate(code)}
              disabled={code.length < 6 || disable.isPending}
            >
              {t("settings.twofaDisable")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Organization profile ────────────────────────────────────────────────────

function OrganizationProfileTab() {
  const { t } = useTranslation();
  return (
    <>
      <OrganizationSettingsCard />

      {/* TODO(backend): logo upload + tagline aren't on Organization yet.
          Once a storage endpoint exists, wire the upload here and extend
          OrganizationUpdateInput / Organization with `tagline` + `logo_url`
          (already on the type — needs an upload endpoint). */}
      <div className="card max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">{t("settings.logo")}</h2>
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="h-16 w-16 rounded-xl border border-sky-200 bg-tranquil-100"
          />
          <button type="button" className="btn-primary opacity-60" disabled>
            {t("settings.logoUpload")}
          </button>
        </div>
        <p className="text-xs text-gray-500">{t("settings.logoUploadTodo")}</p>
      </div>

      <div className="card max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">{t("settings.tagline")}</h2>
        <input
          className="input"
          disabled
          placeholder={t("app.tagline")}
          aria-label={t("settings.tagline")}
        />
        <p className="text-xs text-gray-500">{t("settings.logoUploadTodo")}</p>
      </div>
    </>
  );
}

// ─── Business rules (stub) ───────────────────────────────────────────────────

interface BusinessRule {
  id: "show_financial_to_guardian" | "auto_publish_reports";
  defaultValue: boolean;
}

const BUSINESS_RULES: BusinessRule[] = [
  { id: "show_financial_to_guardian", defaultValue: false },
  { id: "auto_publish_reports", defaultValue: false },
];

function BusinessRulesTab() {
  const { t } = useTranslation();

  // TODO(backend): persist via PATCH /organization with a `business_rules`
  // payload. Right now the field doesn't exist on Organization, so changes
  // are local-only and not sent to the server.
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BUSINESS_RULES.map((r) => [r.id, r.defaultValue])),
  );

  return (
    <div className="card max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          {t("settings.businessRulesTab.title")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("settings.businessRulesTab.description")}
        </p>
      </div>

      <div className="space-y-3">
        {BUSINESS_RULES.map((rule) => {
          const id = `rule-${rule.id}`;
          const titleKey = `settings.businessRulesTab.${
            rule.id === "show_financial_to_guardian"
              ? "showFinancialToGuardian"
              : "autoPublishReports"
          }`;
          const descKey = `${titleKey}Desc`;
          return (
            <div
              key={rule.id}
              className="panel flex items-start justify-between gap-4"
            >
              <div className="flex-1">
                <label
                  htmlFor={id}
                  className="block text-sm font-medium text-gray-800 dark:text-gray-100"
                >
                  {t(titleKey)}
                </label>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {t(descKey)}
                </p>
              </div>
              <input
                id={id}
                type="checkbox"
                role="switch"
                checked={values[rule.id]}
                onChange={(e) =>
                  setValues({ ...values, [rule.id]: e.target.checked })
                }
                className="mt-1 h-5 w-5 cursor-pointer"
              />
            </div>
          );
        })}
      </div>

      <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
        {t("settings.businessRulesTab.todo")}
      </p>
      <button type="button" className="btn-primary opacity-60" disabled>
        {t("common.save")}
      </button>
    </div>
  );
}

// ─── Integrations (stub) ─────────────────────────────────────────────────────

function IntegrationsTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">
          {t("settings.integrationsTab.title")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("settings.integrationsTab.description")}
        </p>
      </div>

      <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
        {t("settings.integrationsTab.todo")}
      </p>

      {/* TODO(backend): replace stub fields with real /integrations endpoints
          (MyFatoorah, SMTP, S3). Secrets must be masked on read (server
          returns "********") and only sent on write when explicitly changed. */}

      <IntegrationCard
        title={t("settings.integrationsTab.myfatoorah")}
        description={t("settings.integrationsTab.myfatoorahDescription")}
        fields={[
          { labelKey: "settings.integrationsTab.apiKey", name: "mf_api_key" },
          { labelKey: "settings.integrationsTab.secret", name: "mf_secret", secret: true },
        ]}
      />
      <IntegrationCard
        title={t("settings.integrationsTab.smtp")}
        description={t("settings.integrationsTab.smtpDescription")}
        fields={[
          { labelKey: "settings.integrationsTab.host", name: "smtp_host" },
          { labelKey: "settings.integrationsTab.port", name: "smtp_port" },
          { labelKey: "settings.integrationsTab.username", name: "smtp_user" },
          { labelKey: "settings.integrationsTab.secret", name: "smtp_secret", secret: true },
        ]}
      />
      <IntegrationCard
        title={t("settings.integrationsTab.s3")}
        description={t("settings.integrationsTab.s3Description")}
        fields={[
          { labelKey: "settings.integrationsTab.endpoint", name: "s3_endpoint" },
          { labelKey: "settings.integrationsTab.bucket", name: "s3_bucket" },
          { labelKey: "settings.integrationsTab.region", name: "s3_region" },
          { labelKey: "settings.integrationsTab.apiKey", name: "s3_access" },
          { labelKey: "settings.integrationsTab.secret", name: "s3_secret", secret: true },
        ]}
      />
    </div>
  );
}

interface IntegrationField {
  labelKey: string;
  name: string;
  secret?: boolean;
}

function IntegrationCard({
  title,
  description,
  fields,
}: {
  title: string;
  description: string;
  fields: IntegrationField[];
}) {
  const { t } = useTranslation();
  return (
    <div className="card max-w-2xl space-y-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-xs text-gray-600 dark:text-gray-300">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} label={t(f.labelKey)}>
            <input
              className="input"
              type={f.secret ? "password" : "text"}
              placeholder={f.secret ? "••••••••" : ""}
              disabled
              aria-label={t(f.labelKey)}
            />
          </Field>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-primary opacity-60" disabled>
          {t("common.save")}
        </button>
        <button
          type="button"
          className="rounded-lg border border-sky-200 px-3 py-2 text-sm text-gray-700 opacity-60 dark:border-gray-700 dark:text-gray-200"
          disabled
        >
          {t("settings.integrationsTab.test")}
        </button>
      </div>
    </div>
  );
}

// ─── Danger zone (stub) ──────────────────────────────────────────────────────

function DangerZoneTab() {
  const { t } = useTranslation();
  return (
    <div className="card max-w-2xl space-y-5 border-danger-100">
      <div>
        <h2 className="text-lg font-semibold text-danger-700">
          {t("settings.dangerTab.title")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("settings.dangerTab.description")}
        </p>
      </div>

      {/* TODO(backend): wire to POST /organization/transfer-ownership once
          the endpoint exists; the form should require typing the org name
          + selecting a target user. */}
      <DangerAction
        title={t("settings.dangerTab.transferOwnership")}
        description={t("settings.dangerTab.transferOwnershipDescription")}
        cta={t("settings.dangerTab.transferOwnership")}
      />

      {/* TODO(backend): wire to DELETE /organization (soft-delete with a
          30-day grace period) once the endpoint exists; require typing
          the org name + a second-factor confirmation. */}
      <DangerAction
        title={t("settings.dangerTab.deleteOrg")}
        description={t("settings.dangerTab.deleteOrgDescription")}
        cta={t("settings.dangerTab.deleteOrg")}
      />

      <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700">
        {t("settings.dangerTab.todo")}
      </p>
    </div>
  );
}

function DangerAction({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-danger-100 bg-danger-50/40 p-4">
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          {description}
        </p>
      </div>
      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded-lg border border-danger-600 px-3 py-2 text-sm font-medium text-danger-700 opacity-60"
      >
        {cta}
      </button>
    </div>
  );
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </label>
  );
}
