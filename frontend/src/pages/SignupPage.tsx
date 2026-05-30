import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PasswordStrengthMeter } from "@/components/PasswordStrengthMeter";
import { donorSignup, resendVerification } from "@/lib/donorAuth";

import "./SignupPage.css";

// Dial codes for the phone row. Symbols/numbers only — no i18n needed.
// The contract takes `country_code` as a 2-letter ISO residence code
// (validated min/max 2), so the dial code is folded into `phone` here.
const DIAL_CODES = ["+965", "+966", "+971", "+974", "+973", "+968", "+1", "+44"];

// Country options for the nationality / residence selects. The ISO code
// feeds `country_code` (residence only); `other` sends no code.
const COUNTRY_CODES = ["KW", "SA", "AE", "QA", "BH", "OM", "other"] as const;

type StepErrors = Record<string, string>;

export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = params.get("intent");

  const [step, setStep] = useState(1);

  // Step 1 — account
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Step 2 — personal info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dialCode, setDialCode] = useState(DIAL_CODES[0]);
  const [phone, setPhone] = useState("");
  const [nationality, setNationality] = useState("");
  const [residence, setResidence] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [errors, setErrors] = useState<StepErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Live password checks (drive the strength meter + checklist) ──
  const checks = useMemo(
    () => ({
      length: password.length >= 8,
      digit: /\d/.test(password),
      upper: /[A-Z]/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
    }),
    [password],
  );

  const mut = useMutation({
    mutationFn: () =>
      donorSignup({
        email,
        password,
        full_name: `${firstName} ${lastName}`.trim(),
        phone: phone.trim() ? `${dialCode} ${phone.trim()}` : undefined,
        // Residence drives the ISO country_code; nationality is collected
        // for parity with A-02 but has no slot in the signup contract
        // (set later in settings, like currency/language).
        country_code:
          residence && residence !== "other" ? residence : undefined,
      }),
    onSuccess: (data) => {
      // Preserve sponsor-intent across the email-verification round trip.
      if (intent) sessionStorage.setItem("rufaqaa:postVerifyIntent", intent);
      // In dev the backend echoes the verification token so tests can
      // follow it without an email server.
      if (data.debug_verify_token) {
        sessionStorage.setItem(
          "rufaqaa:debugVerifyToken",
          data.debug_verify_token,
        );
      }
      setStep(3);
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError
          ? (err.response?.data?.detail ?? err.message)
          : (err as Error).message;
      setServerError(String(msg));
    },
  });

  const resendMut = useMutation({
    mutationFn: () => resendVerification(email),
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  function validateStep1(): boolean {
    const next: StepErrors = {};
    if (!emailValid) next.email = t("auth.invalidEmail");
    if (!checks.length) next.password = t("signup.validation.passwordWeak");
    if (confirm !== password || !confirm)
      next.confirm = t("auth.passwordMismatch");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function validateStep2(): boolean {
    const next: StepErrors = {};
    if (!firstName.trim()) next.firstName = t("signup.validation.firstName");
    if (!lastName.trim()) next.lastName = t("signup.validation.lastName");
    if (!agreed) next.terms = t("signup.mustAccept");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleNext() {
    setServerError(null);
    if (step === 1 && validateStep1()) setStep(2);
  }

  function handleBack() {
    setServerError(null);
    setErrors({});
    if (step > 1) setStep(step - 1);
  }

  function handleSubmit() {
    setServerError(null);
    if (validateStep2()) mut.mutate();
  }

  const pct = Math.round((step / 3) * 100);
  const STEP_KEYS = ["account", "info", "verify"] as const;

  return (
    <div className="sg-root">
      <div className="sg-lang">
        <LanguageSwitcher />
      </div>

      <div className="sg-page">
        {/* ═══ Brand row ═══ */}
        <div className="sg-brand-row">
          <div className="sg-brand">
            <div className="sg-brand-mark" aria-hidden="true">
              ر
            </div>
            <div className="sg-brand-info">
              <h1>{t("auth.login.brandName")}</h1>
              <p>{t("auth.login.brandTagline")}</p>
            </div>
          </div>
          <Link to="/login" className="sg-login-link">
            {t("signup.loginLink")}
            <ChevronStart />
          </Link>
        </div>

        <div className="sg-card">
          {/* ═══ Head ═══ */}
          <div className="sg-card-head">
            <span className="sg-eyebrow">
              <StarIcon />
              {t("signup.eyebrow")}
            </span>
            <h2>{t("signup.headline")}</h2>
            <p>{t("signup.subtitle")}</p>
          </div>

          {/* ═══ Progress ═══ */}
          <div className="sg-progress">
            <div className="sg-progress-row">
              <span>
                {t("signup.progress.stepLabel")}{" "}
                <strong>
                  {t("signup.progress.stepValue", { current: step, total: 3 })}
                </strong>
              </span>
              <span>
                <strong className="sg-num">{pct}%</strong>{" "}
                {t("signup.progress.done")}
              </span>
            </div>
            <div
              className="sg-progress-track"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={3}
              aria-valuenow={step}
              aria-label={t("signup.progress.stepLabel")}
            >
              <div className="sg-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="sg-progress-steps">
              {STEP_KEYS.map((key, i) => {
                const marker = i + 1;
                const state =
                  marker === step ? "active" : marker < step ? "done" : "";
                return (
                  <div
                    key={key}
                    className={`sg-pstep${state ? ` ${state}` : ""}`}
                    aria-current={marker === step ? "step" : undefined}
                  >
                    <div className="sg-pstep-dot">
                      {marker < step ? <CheckIcon /> : marker}
                    </div>
                    <div className="sg-pstep-label">
                      {t(`signup.steps.${key}`)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ Body ═══ */}
          <div className="sg-card-body">
            {step === 1 && (
              <section
                className="sg-step"
                aria-labelledby="sg-s1-title"
                key="step1"
              >
                <div className="sg-step-head">
                  <h3 id="sg-s1-title">{t("signup.step1.title")}</h3>
                  <p>{t("signup.step1.subtitle")}</p>
                </div>

                <div className="sg-field">
                  <label htmlFor="sg-email">{t("auth.email")}</label>
                  <input
                    id="sg-email"
                    type="email"
                    className={`sg-input sg-latin${errors.email ? " sg-error" : ""}`}
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={!!errors.email}
                  />
                  {errors.email && (
                    <p className="sg-field-error" role="alert">
                      {errors.email}
                    </p>
                  )}
                </div>

                <div className="sg-field">
                  <label htmlFor="sg-password">{t("auth.password")}</label>
                  <div className="sg-field-input-wrap">
                    <input
                      id="sg-password"
                      type={showPassword ? "text" : "password"}
                      className={`sg-input sg-input--password sg-latin${errors.password ? " sg-error" : ""}`}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!errors.password}
                    />
                    <button
                      type="button"
                      className="sg-field-eye"
                      aria-label={t("auth.login.showPassword")}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>

                  <PasswordStrengthMeter password={password} />
                  {errors.password && (
                    <p className="sg-field-error" role="alert">
                      {errors.password}
                    </p>
                  )}
                </div>

                <div className="sg-field">
                  <label htmlFor="sg-confirm">
                    {t("signup.fields.confirmPassword")}
                  </label>
                  <div className="sg-field-input-wrap">
                    <input
                      id="sg-confirm"
                      type={showConfirm ? "text" : "password"}
                      className={`sg-input sg-input--password sg-latin${errors.confirm ? " sg-error" : ""}`}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      aria-invalid={!!errors.confirm}
                    />
                    <button
                      type="button"
                      className="sg-field-eye"
                      aria-label={t("auth.login.showPassword")}
                      aria-pressed={showConfirm}
                      onClick={() => setShowConfirm((v) => !v)}
                    >
                      {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                  {errors.confirm && (
                    <p className="sg-field-error" role="alert">
                      {errors.confirm}
                    </p>
                  )}
                </div>

                <div className="sg-or-divider">{t("signup.orFast")}</div>

                <div className="sg-social-buttons">
                  <button
                    type="button"
                    className="sg-social-btn"
                    disabled
                    title={t("common.comingSoon")}
                    aria-label={t("auth.login.continueWithGoogle")}
                  >
                    <span className="sg-logo-icon" aria-hidden="true">
                      <GoogleIcon />
                    </span>
                    Google
                  </button>
                  <button
                    type="button"
                    className="sg-social-btn"
                    disabled
                    title={t("common.comingSoon")}
                    aria-label={t("auth.login.continueWithApple")}
                  >
                    <span className="sg-logo-icon" aria-hidden="true">
                      <AppleIcon />
                    </span>
                    Apple
                  </button>
                </div>
              </section>
            )}

            {step === 2 && (
              <section
                className="sg-step"
                aria-labelledby="sg-s2-title"
                key="step2"
              >
                <div className="sg-step-head">
                  <h3 id="sg-s2-title">{t("signup.step2.title")}</h3>
                  <p>{t("signup.step2.subtitle")}</p>
                </div>

                <div className="sg-field-row">
                  <div className="sg-field">
                    <label htmlFor="sg-first">
                      {t("signup.fields.firstName")}
                    </label>
                    <input
                      id="sg-first"
                      type="text"
                      className={`sg-input${errors.firstName ? " sg-error" : ""}`}
                      placeholder={t("signup.placeholders.firstName")}
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      aria-invalid={!!errors.firstName}
                    />
                    {errors.firstName && (
                      <p className="sg-field-error" role="alert">
                        {errors.firstName}
                      </p>
                    )}
                  </div>
                  <div className="sg-field">
                    <label htmlFor="sg-last">
                      {t("signup.fields.lastName")}
                    </label>
                    <input
                      id="sg-last"
                      type="text"
                      className={`sg-input${errors.lastName ? " sg-error" : ""}`}
                      placeholder={t("signup.placeholders.lastName")}
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      aria-invalid={!!errors.lastName}
                    />
                    {errors.lastName && (
                      <p className="sg-field-error" role="alert">
                        {errors.lastName}
                      </p>
                    )}
                  </div>
                </div>

                <div className="sg-field">
                  <label htmlFor="sg-phone">{t("signup.fields.phone")}</label>
                  <div className="sg-phone-wrap">
                    <select
                      className="sg-select sg-latin"
                      aria-label={t("signup.fields.countryCode")}
                      value={dialCode}
                      onChange={(e) => setDialCode(e.target.value)}
                    >
                      {DIAL_CODES.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <input
                      id="sg-phone"
                      type="tel"
                      className="sg-input sg-latin"
                      placeholder="9876 5432"
                      autoComplete="tel-national"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <p className="sg-field-hint">{t("signup.phoneHint")}</p>
                </div>

                <div className="sg-field-row">
                  <div className="sg-field">
                    <label htmlFor="sg-nationality">
                      {t("signup.fields.nationality")}
                    </label>
                    <select
                      id="sg-nationality"
                      className="sg-select"
                      value={nationality}
                      onChange={(e) => setNationality(e.target.value)}
                    >
                      <option value="">{t("signup.selectPlaceholder")}</option>
                      {COUNTRY_CODES.map((c) => (
                        <option key={c} value={c}>
                          {t(`signup.countries.${c}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sg-field">
                    <label htmlFor="sg-residence">
                      {t("signup.fields.residence")}
                    </label>
                    <select
                      id="sg-residence"
                      className="sg-select"
                      value={residence}
                      onChange={(e) => setResidence(e.target.value)}
                    >
                      <option value="">{t("signup.selectPlaceholder")}</option>
                      {COUNTRY_CODES.map((c) => (
                        <option key={c} value={c}>
                          {t(`signup.countries.${c}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  className={`sg-terms${agreed ? " checked" : ""}${
                    errors.terms ? " sg-error" : ""
                  }`}
                  role="checkbox"
                  aria-checked={agreed}
                  onClick={() => setAgreed((v) => !v)}
                >
                  <span className="sg-terms-check" aria-hidden="true" />
                  <span>{t("signup.acceptTerms")}</span>
                </button>
                {errors.terms && (
                  <p className="sg-field-error" role="alert">
                    {errors.terms}
                  </p>
                )}
              </section>
            )}

            {step === 3 && (
              <section
                className="sg-step"
                aria-labelledby="sg-s3-title"
                key="step3"
              >
                {intent && (
                  <div className="sg-info-note" style={{ marginTop: 0 }}>
                    <StarIcon />
                    <span>
                      {t("signup.sponsorIntent", {
                        code: intent.replace("sponsor:", ""),
                      })}
                    </span>
                  </div>
                )}
                <div className="sg-verify">
                  <div className="sg-verify-icon" aria-hidden="true">
                    <MailIcon />
                  </div>
                  <h3 id="sg-s3-title">{t("signup.step3.title")}</h3>
                  <p>
                    {t("signup.step3.sentTo")}{" "}
                    <span className="sg-verify-email sg-latin">{email}</span>
                  </p>

                  <div className="sg-verify-actions">
                    <button
                      type="button"
                      className="sg-foot-btn sg-foot-btn-secondary"
                      onClick={() => resendMut.mutate()}
                      disabled={resendMut.isPending}
                    >
                      {resendMut.isPending
                        ? t("auth.submitting")
                        : t("signup.buttons.resend")}
                    </button>
                    <button
                      type="button"
                      className="sg-foot-btn sg-foot-btn-primary"
                      onClick={() => navigate("/verify-email")}
                    >
                      {t("signup.buttons.goVerify")}
                    </button>
                  </div>

                  {resendMut.isSuccess && (
                    <p className="sg-resent-note" role="status">
                      {t("verifyPending.resentNote")}
                    </p>
                  )}

                  <div className="sg-info-note">
                    <InfoIcon />
                    <span>{t("signup.step3.spamHint")}</span>
                  </div>
                </div>
              </section>
            )}
          </div>

          {serverError && (
            <p className="sg-form-error" role="alert">
              {serverError}
            </p>
          )}

          {/* ═══ Footer (steps 1 & 2 only) ═══ */}
          {step < 3 && (
            <div className="sg-card-foot">
              <button
                type="button"
                className="sg-foot-btn sg-foot-btn-secondary"
                onClick={handleBack}
                disabled={step === 1}
              >
                <ChevronStart />
                {t("signup.buttons.back")}
              </button>
              {step === 1 ? (
                <button
                  type="button"
                  className="sg-foot-btn sg-foot-btn-primary"
                  onClick={handleNext}
                >
                  {t("signup.buttons.next")}
                  <ChevronStart />
                </button>
              ) : (
                <button
                  type="button"
                  className="sg-foot-btn sg-foot-btn-primary"
                  onClick={handleSubmit}
                  disabled={mut.isPending}
                >
                  {mut.isPending
                    ? t("auth.submitting")
                    : t("signup.buttons.createAccount")}
                  <CheckIcon />
                </button>
              )}
            </div>
          )}
        </div>

        <p
          style={{
            textAlign: "center",
            marginTop: 22,
            fontSize: 13.5,
            color: "var(--gray-600)",
          }}
        >
          {t("signup.haveAccount")}{" "}
          <Link
            to="/login"
            style={{ color: "var(--trust-500)", fontWeight: 600 }}
          >
            {t("public.nav.login")}
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ═══ Icons (design-system stroke, currentColor) ═══ */

function ChevronStart() {
  return (
    <svg className="sg-icon sg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="sg-icon sg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="36"
      height="36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="sg-icon sg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="sg-icon sg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="sg-icon sg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.6 12.7c0-2.1 1.7-3.1 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.5-1.2-.1-2.4.7-3 .7s-1.5-.7-2.5-.7c-1.3 0-2.5.7-3.1 1.9-1.4 2.3-.4 5.8 1 7.7.7.9 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6s1.5.6 2.5.6 1.7-.9 2.3-1.8c.7-1 1-2 1-2 0-.1-2-.7-2-3.2zM15.7 6.8c.5-.6.9-1.5.8-2.3-.8 0-1.7.5-2.2 1.1-.5.5-.9 1.4-.8 2.2.8.1 1.7-.4 2.2-1z" />
    </svg>
  );
}
