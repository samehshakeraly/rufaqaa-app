import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { resetPassword } from "@/lib/auth";

import "./ResetPasswordPage.css";

// A-03 Password Reset, state 3 ("اختر كلمة مرور جديدة") → state 4 ("تمّ تغيير
// كلمة المرور"). The token comes from the emailed link (?token=...).

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
          {mut.isSuccess ? (
            // ═══ State 4: password changed ═══
            <>
              <div className="rp-step-head">
                <div className="rp-step-icon rp-success" aria-hidden="true">
                  <CheckIcon />
                </div>
                <h1>{t("auth.resetDoneTitle")}</h1>
                <p>{t("auth.resetDone")}</p>
              </div>

              <button
                type="button"
                className="rp-btn-primary"
                onClick={() => navigate("/donor/dashboard")}
              >
                {t("auth.goToDashboard")}
              </button>

              <div className="rp-center-link">
                <Link to="/login" className="rp-back-link">
                  <ChevronIcon />
                  {t("auth.backToLogin")}
                </Link>
              </div>
            </>
          ) : (
            // ═══ State 3: choose a new password ═══
            <>
              <div className="rp-step-head">
                <div className="rp-step-icon" aria-hidden="true">
                  <LockIcon />
                </div>
                <h1>{t("auth.resetTitle")}</h1>
                <p>{t("auth.resetSubtitle")}</p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setServerError(null);
                  if (!token || tooShort || mismatch) return;
                  mut.mutate();
                }}
              >
                {/* Manual token entry only when the link didn't carry one. */}
                {!tokenFromUrl && (
                  <div className="rp-field">
                    <label htmlFor="reset-token">{t("auth.resetToken")}</label>
                    <input
                      id="reset-token"
                      className="rp-input rp-latin"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </div>
                )}

                <div className="rp-field">
                  <label htmlFor="new-password">{t("auth.newPassword")}</label>
                  <input
                    id="new-password"
                    type="password"
                    className="rp-input rp-latin"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <PasswordStrengthMeter password={password} />
                  {tooShort && (
                    <p className="rp-field-error">{t("auth.passwordTooShort")}</p>
                  )}
                </div>

                <div className="rp-field">
                  <label htmlFor="confirm-password">
                    {t("auth.confirmPassword")}
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    className="rp-input rp-latin"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  {mismatch && (
                    <p className="rp-field-error">{t("auth.passwordMismatch")}</p>
                  )}
                </div>

                <div className="rp-notice">
                  <ShieldIcon />
                  <span>{t("auth.logoutOtherDevices")}</span>
                </div>

                {serverError && <p className="rp-form-error">{serverError}</p>}

                <button
                  type="submit"
                  className="rp-btn-primary"
                  disabled={
                    mut.isPending || !token || tooShort || mismatch || !password
                  }
                >
                  {mut.isPending ? t("auth.submitting") : t("auth.changePassword")}
                </button>
              </form>

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
      <circle cx="12" cy="16" r="1" />
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="rp-icon rp-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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
