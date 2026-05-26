import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { resetPassword } from "@/lib/auth";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const tokenFromUrl = params.get("token") ?? "";
  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => resetPassword(token, password),
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  const mismatch = password.length > 0 && confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  return (
    <div className="flex min-h-screen items-center justify-center bg-tranquil px-4">
      <div className="card w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-trust">{t("auth.resetTitle")}</h1>
        </div>

        {mut.isSuccess ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {t("auth.resetDone")}
            </p>
            <Link to="/login" className="block text-center text-sm text-trust underline">
              {t("auth.backToLogin")}
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setServerError(null);
              if (!token || tooShort || mismatch) return;
              mut.mutate();
            }}
            className="space-y-4"
          >
            {!tokenFromUrl && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  {t("auth.resetToken")}
                </span>
                <input
                  className="input"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("auth.newPassword")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {tooShort && (
                <p className="mt-1 text-xs text-red-600">{t("auth.passwordTooShort")}</p>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("auth.confirmPassword")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && (
                <p className="mt-1 text-xs text-red-600">{t("auth.passwordMismatch")}</p>
              )}
            </label>
            {serverError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {serverError}
              </p>
            )}
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={mut.isPending || !token || tooShort || mismatch || !password}
            >
              {mut.isPending ? t("auth.submitting") : t("auth.resetSubmit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
