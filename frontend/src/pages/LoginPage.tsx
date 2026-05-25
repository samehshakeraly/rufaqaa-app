import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { login } from "@/lib/auth";
import { useAuthStore } from "@/store/auth";

function buildSchema(t: (k: string) => string) {
  return z.object({
    email: z.string().email(t("auth.invalidEmail")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(buildSchema(t)),
    defaultValues: { email: "admin@dev.rufaqaa.app", password: "" },
  });

  const mutation = useMutation({
    mutationFn: (v: FormValues) => login(v.email, v.password),
    onSuccess: (data) => {
      setTokens(data.access_token, data.refresh_token);
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
      navigate(from ?? "/dashboard", { replace: true });
    },
    onError: (err) => {
      if (err instanceof AxiosError && err.response?.status === 401) {
        setServerError(t("auth.invalidCredentials"));
      } else {
        setServerError(t("auth.serverError"));
      }
    },
  });

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-tranquil px-4">
      <div className="card w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-trust">{t("app.name")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("app.tagline")}</p>
        </div>

        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            mutation.mutate(v);
          })}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.email")}
            </span>
            <input
              type="email"
              autoComplete="email"
              className="input"
              {...register("email")}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {t("auth.password")}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              className="input"
              {...register("password")}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </label>

          {serverError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {serverError}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? t("auth.submitting") : t("auth.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
