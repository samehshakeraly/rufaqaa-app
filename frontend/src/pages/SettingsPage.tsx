import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { api } from "@/lib/api";
import { disable2FA, enroll2FA, verify2FA } from "@/lib/twofa";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toasts";

import { OrganizationSettingsCard } from "@/components/OrganizationSettingsCard";

function buildSchema(t: (k: string) => string) {
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

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

export function SettingsPage() {
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(buildSchema(t)) });

  const mut = useMutation({
    mutationFn: (v: FormValues) =>
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("settings.title")}</h1>

      <form
        onSubmit={handleSubmit((v) => {
          setSuccess(false);
          mut.mutate(v);
        })}
        className="card max-w-lg space-y-4"
      >
        <h2 className="text-lg font-semibold">{t("settings.changePassword")}</h2>

        <Field label={t("settings.currentPassword")} error={errors.current_password?.message}>
          <input type="password" className="input" {...register("current_password")} />
        </Field>
        <Field label={t("settings.newPassword")} error={errors.new_password?.message}>
          <input type="password" className="input" {...register("new_password")} />
        </Field>
        <Field label={t("settings.confirmPassword")} error={errors.confirm_password?.message}>
          <input type="password" className="input" {...register("confirm_password")} />
        </Field>

        {serverError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
        )}
        {success && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {t("settings.changedSuccess")}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t("common.saving") : t("common.save")}
        </button>
      </form>

      <TwoFASection />

      <OrganizationSettingsCard />
    </div>
  );
}

function TwoFASection() {
  const { t } = useTranslation();
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const enroll = useMutation({
    mutationFn: enroll2FA,
    onSuccess: (data) => setEnrollment({ secret: data.secret, uri: data.otpauth_uri }),
    onError: (err) => {
      if (err instanceof AxiosError) toast.error(err.response?.data?.detail ?? "2FA failed");
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
          <p className="text-sm text-slate-600">{t("settings.twofaDescription")}</p>
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
          <p className="text-sm text-slate-700">{t("settings.twofaScanInstruction")}</p>
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
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("settings.twofaBackupWarning")}
          </p>
          <pre className="grid grid-cols-2 gap-1 rounded-lg bg-snow p-3 font-mono text-xs">
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
              className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil"
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}
