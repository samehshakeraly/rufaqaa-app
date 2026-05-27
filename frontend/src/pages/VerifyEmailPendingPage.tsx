import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { resendVerification, verifyEmail } from "@/lib/donorAuth";
import { useAuthStore } from "@/store/auth";

/**
 * After signup the user lands here. They expect to receive an email
 * (or, in dev, we stashed the token in sessionStorage). The page lets
 * them paste / auto-pick up the token and verifies in place.
 */
export function VerifyEmailPendingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [resendEmail, setResendEmail] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  // Dev shortcut: if signup left a token in sessionStorage we can
  // verify immediately. Production donors get this via email instead.
  const debugToken = sessionStorage.getItem("rufaqaa:debugVerifyToken");

  const verifyMut = useMutation({
    mutationFn: (token: string) => verifyEmail(token),
    onSuccess: (pair) => {
      setTokens(pair.access_token, pair.refresh_token);
      sessionStorage.removeItem("rufaqaa:debugVerifyToken");
      const intent = sessionStorage.getItem("rufaqaa:postVerifyIntent");
      if (intent?.startsWith("sponsor:")) {
        sessionStorage.removeItem("rufaqaa:postVerifyIntent");
        const code = intent.slice("sponsor:".length);
        navigate(`/sponsor/${code}/checkout`, { replace: true });
      } else {
        navigate("/donor/dashboard", { replace: true });
      }
    },
    onError: () => setServerError(t("verifyPending.bad")),
  });
  const resendMut = useMutation({
    mutationFn: () => resendVerification(resendEmail),
  });

  // Auto-verify if we got here straight from /signup in dev mode.
  useEffect(() => {
    if (debugToken && !verifyMut.isPending && !verifyMut.isSuccess) {
      verifyMut.mutate(debugToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="card space-y-4 text-center">
        <div className="text-5xl">📧</div>
        <h1 className="text-2xl font-bold text-slate-900">
          {t("verifyPending.title")}
        </h1>
        <p className="text-sm text-slate-600">{t("verifyPending.body")}</p>

        {serverError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <div className="space-y-2 rounded-lg border border-sky bg-snow p-3 text-left">
          <p className="text-xs font-medium text-slate-500">
            {t("verifyPending.didntGet")}
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              className="input flex-1"
              placeholder={t("auth.email")}
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil"
              onClick={() => resendMut.mutate()}
              disabled={!resendEmail || resendMut.isPending}
            >
              {t("verifyPending.resend")}
            </button>
          </div>
          {resendMut.isSuccess && (
            <p className="text-xs text-slate-600">{t("verifyPending.resentNote")}</p>
          )}
        </div>

        <Link to="/" className="block text-sm text-trust underline">
          ← {t("public.nav.toHome")}
        </Link>
      </div>
    </div>
  );
}
