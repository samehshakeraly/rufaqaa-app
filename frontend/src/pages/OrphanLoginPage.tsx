import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";
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

/** O-01 — warm, simple sign-in for the orphan portal. Same auth flow as
 * the other portals; on success we send the orphan to their home. */
export function OrphanLoginPage() {
  const navigate = useNavigate();
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
    defaultValues: { email: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: (v: FormValues) => login(v.email, v.password),
    onSuccess: (data) => {
      setTokens(data.access_token, data.refresh_token);
      navigate("/orphan", { replace: true });
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
    return <Navigate to="/orphan" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-tranquil-100 px-4 dark:bg-gray-900">
      <div className="card w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>

        <div className="mb-6 flex flex-col items-center text-center">
          <WelcomeIllustration />
          <h1 className="mt-4 text-2xl font-bold text-trust-700 dark:text-trust-100">
            {t("orphan.login.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("orphan.login.subtitle")}
          </p>
        </div>

        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            mutation.mutate(v);
          })}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("auth.email")}
            </span>
            <input
              type="email"
              autoComplete="email"
              className="input"
              {...register("email")}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-danger-700" role="alert">
                {errors.email.message}
              </p>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("auth.password")}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              className="input"
              {...register("password")}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-danger-700" role="alert">
                {errors.password.message}
              </p>
            )}
          </label>

          {serverError && (
            <p
              role="alert"
              className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
            >
              {serverError}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? t("auth.submitting") : t("orphan.login.submit")}
          </button>

          <Link
            to="/forgot-password"
            className="block text-center text-sm text-trust-600 underline dark:text-trust-100"
          >
            {t("auth.forgotLink")}
          </Link>
        </form>
      </div>
    </div>
  );
}

/** Friendly abstract illustration — a sun over hills. No real children. */
function WelcomeIllustration() {
  return (
    <svg
      className="h-24 w-24"
      viewBox="0 0 120 120"
      role="img"
      aria-label=""
      aria-hidden="true"
      fill="none"
    >
      <circle cx="60" cy="52" r="22" className="fill-trust-300" />
      <g
        className="stroke-sky-200"
        strokeWidth="4"
        strokeLinecap="round"
      >
        <line x1="60" y1="14" x2="60" y2="24" />
        <line x1="88" y1="24" x2="82" y2="30" />
        <line x1="32" y1="24" x2="38" y2="30" />
        <line x1="98" y1="52" x2="90" y2="52" />
        <line x1="22" y1="52" x2="30" y2="52" />
      </g>
      <path
        d="M8 96c14-18 30-18 44 0s30 18 44 0 16-12 16-12v32H8z"
        className="fill-tranquil-200"
      />
      <path
        d="M8 104c18-12 34-12 52 0s34 12 52 0v20H8z"
        className="fill-sky-200"
      />
    </svg>
  );
}
