import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { requestPasswordReset } from "@/lib/auth";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [debugToken, setDebugToken] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => requestPasswordReset(email),
    onSuccess: (data) => setDebugToken(data.debug_token),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-tranquil px-4">
      <div className="card w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-trust">{t("auth.forgotTitle")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("auth.forgotDescription")}</p>
        </div>

        {!mut.isSuccess && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email) mut.mutate();
            }}
            className="space-y-4"
          >
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {t("auth.email")}
              </span>
              <input
                type="email"
                autoComplete="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={mut.isPending}
            >
              {mut.isPending ? t("auth.submitting") : t("auth.forgotSubmit")}
            </button>
          </form>
        )}

        {mut.isSuccess && (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {t("auth.forgotSent")}
            </p>
            {debugToken && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="mb-2 font-medium">{t("auth.devTokenNotice")}</p>
                <Link
                  to={`/reset-password?token=${encodeURIComponent(debugToken)}`}
                  className="break-all font-mono text-trust underline"
                >
                  {debugToken}
                </Link>
              </div>
            )}
            <Link to="/login" className="block text-center text-sm text-trust underline">
              {t("auth.backToLogin")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
