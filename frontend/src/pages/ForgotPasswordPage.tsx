import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { requestPasswordReset } from "@/lib/auth";

import "./ResetPasswordPage.css";

// A-03 Password Reset, state 1 ("نسيت كلمة المرور؟") → state 2 ("تحقّق من بريدك").
//
// NOTE: A-03's mockup shows a 6-digit OTP step, but the backend currently
// uses an emailed reset LINK. We implement the real link-based flow here and
// keep the privacy-preserving wording. Switching to OTP (a 6-digit code input)
// is a future backend dependency.

const RESEND_COOLDOWN_SECONDS = 60;

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [debugToken, setDebugToken] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const mut = useMutation({
    mutationFn: () => requestPasswordReset(email),
    onSuccess: (data) => {
      setDebugToken(data.debug_token);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    },
  });

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const sent = mut.isSuccess;

  return (
    <div className="rp-root">
      <div className="rp-lang">
        <LanguageSwitcher />
      </div>

      <div className="rp-page">
        <div className="rp-brand-row">
          <div className="rp-brand-mark" aria-hidden="true">
            ر
          </div>
          <div className="rp-brand-info">
            <h1>{t("auth.login.brandName")}</h1>
            <p>{t("auth.login.brandTagline")}</p>
          </div>
        </div>

        <div className="rp-card">
          {!sent ? (
            // ═══ State 1: request a reset link ═══
            <>
              <div className="rp-step-head">
                <div className="rp-step-icon" aria-hidden="true">
                  <LockIcon />
                </div>
                <h1>{t("auth.forgotHeading")}</h1>
                <p>{t("auth.forgotDescription")}</p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email) mut.mutate();
                }}
              >
                <div className="rp-field">
                  <label htmlFor="reset-email">{t("auth.email")}</label>
                  <div className="rp-field-input-wrap">
                    <input
                      id="reset-email"
                      type="email"
                      className="rp-input rp-latin"
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <span className="rp-field-icon" aria-hidden="true">
                      <MailIcon />
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  className="rp-btn-primary"
                  disabled={mut.isPending}
                >
                  {mut.isPending ? t("auth.submitting") : t("auth.forgotSubmit")}
                </button>
              </form>

              <div className="rp-center-link">
                <Link to="/login" className="rp-back-link">
                  <ChevronIcon />
                  {t("auth.backToLogin")}
                </Link>
              </div>
            </>
          ) : (
            // ═══ State 2: check your email (link-based, privacy-preserving) ═══
            <>
              <div className="rp-step-head">
                <div className="rp-step-icon" aria-hidden="true">
                  <MailIcon big />
                </div>
                <h1>{t("auth.checkEmailTitle")}</h1>
                <p>{t("auth.resetLinkSentBody")}</p>
              </div>

              {/* Dev-only: backend echoes the reset token when AUTH_DEV_TOKENS
                  is set, so the flow can be exercised without an email server. */}
              {debugToken && (
                <div className="rp-dev-token">
                  <p>{t("auth.devTokenNotice")}</p>
                  <Link
                    to={`/reset-password?token=${encodeURIComponent(debugToken)}`}
                    className="rp-dev-token-link rp-latin"
                  >
                    {debugToken}
                  </Link>
                </div>
              )}

              <button
                type="button"
                className="rp-btn-secondary"
                disabled={cooldown > 0 || mut.isPending}
                onClick={() => mut.mutate()}
              >
                {cooldown > 0
                  ? t("auth.resendCooldown", { seconds: cooldown })
                  : t("auth.resendLink")}
              </button>

              <div className="rp-privacy-note">
                <InfoIcon />
                <span>{t("auth.resetPrivacyNote")}</span>
              </div>

              <div className="rp-center-link">
                <Link to="/login" className="rp-back-link">
                  <ChevronIcon />
                  {t("auth.backToLogin")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ Icons (design-system stroke, currentColor) ═══ */

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function MailIcon({ big = false }: { big?: boolean }) {
  return (
    <svg
      className={big ? undefined : "rp-icon rp-icon-sm"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="rp-icon rp-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="rp-icon rp-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
