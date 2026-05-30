import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { resendVerification, verifyEmail } from "@/lib/donorAuth";
import { useAuthStore } from "@/store/auth";

import { BrandMark, ChevronStart, MailIcon } from "./verifyEmailChrome";
import "./VerifyEmailPage.css";

// Matches the resend cooldown on the password-reset flow
// (ForgotPasswordPage) so the resend action can't be spammed.
const RESEND_COOLDOWN_SECONDS = 60;

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
  const [cooldown, setCooldown] = useState(0);

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
    onSuccess: () => {
      setCooldown(RESEND_COOLDOWN_SECONDS);
    },
  });

  // Auto-verify if we got here straight from /signup in dev mode.
  useEffect(() => {
    if (debugToken && !verifyMut.isPending && !verifyMut.isSuccess) {
      verifyMut.mutate(debugToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  return (
    <div className="ve-root">
      <div className="ve-lang">
        <LanguageSwitcher />
      </div>

      <div className="ve-page">
        {/* ═══ Brand row ═══ */}
        <div className="ve-brand-row">
          <div className="ve-brand">
            <BrandMark />
            <div className="ve-brand-info">
              <h1>{t("auth.login.brandName")}</h1>
              <p>{t("auth.login.brandTagline")}</p>
            </div>
          </div>
          <Link to="/" className="ve-brand-link">
            {t("public.nav.toHome")}
            <ChevronStart />
          </Link>
        </div>

        <div className="ve-card">
          <div className="ve-status">
            <div
              className="ve-status-icon ve-status-icon--info"
              aria-hidden="true"
            >
              <MailIcon />
            </div>
            <h1>{t("verifyPending.title")}</h1>
            <p>{t("verifyPending.body")}</p>

            {serverError && (
              <p className="ve-form-error" role="alert">
                {serverError}
              </p>
            )}

            <div className="ve-resend">
              <p className="ve-resend-label">{t("verifyPending.didntGet")}</p>
              <div className="ve-resend-row">
                <input
                  type="email"
                  className="ve-input ve-latin"
                  placeholder={t("auth.email")}
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                />
                <button
                  type="button"
                  className="ve-btn ve-btn-secondary"
                  onClick={() => resendMut.mutate()}
                  disabled={!resendEmail || resendMut.isPending || cooldown > 0}
                >
                  {resendMut.isPending
                    ? t("auth.submitting")
                    : cooldown > 0
                      ? t("auth.resendCooldown", { seconds: cooldown })
                      : t("verifyPending.resend")}
                </button>
              </div>
              {resendMut.isSuccess && (
                <p className="ve-resent-note" role="status">
                  {t("verifyPending.resentNote")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
