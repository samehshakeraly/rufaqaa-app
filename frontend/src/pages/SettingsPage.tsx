import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

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
      // Server has revoked every refresh token, so log out locally too.
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
