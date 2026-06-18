import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { login } from "@/lib/auth";
import { useAuthStore } from "@/store/auth";

import "./OrphanLoginPage.css";

function buildSchema(t: (k: string) => string) {
  return z.object({
    email: z.string().email(t("auth.invalidEmail")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** O-01 — warm, simple sign-in for the orphan portal. Same auth flow as
 * the other portals (email + password); on success the orphan lands on
 * their home. Password recovery is routed through the guardian — this is
 * a child-facing screen, so it carries no financial/donor/identity data. */
export function OrphanLoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
      // Clear any prior user's cached queries before this session begins.
      qc.clear();
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
    <div className="olg-root">
      <div className="olg-page">
        {/* Illustration / greeting */}
        <section className="olg-illu" aria-hidden="true">
          <div className="olg-illu-art">
            <WelcomeStar />
          </div>
          <div className="olg-illu-greeting">
            <span className="olg-eyebrow">
              <span className="olg-eyebrow-dot" />
              {t("orphan.login.eyebrow")}
            </span>
            <div className="olg-illu-title">
              {t("orphan.login.illTitle")}{" "}
              <span className="olg-illu-accent">{t("orphan.login.illTitleAccent")}</span>
            </div>
            <p className="olg-illu-sub">{t("orphan.login.illSub")}</p>
          </div>
        </section>

        {/* Form */}
        <main className="olg-form-panel" role="main">
          <div className="olg-brand">
            <span className="olg-brand-mark" aria-hidden="true">
              ر
            </span>
            <div className="olg-brand-text">
              <h1>{t("auth.login.brandName")}</h1>
              <p>{t("auth.login.brandTagline")}</p>
            </div>
          </div>

          <div className="olg-form-inner">
            <div className="olg-form-head">
              <h2 className="olg-form-title">{t("orphan.login.title")}</h2>
              <p className="olg-form-sub">{t("orphan.login.subtitle")}</p>
            </div>

            <form
              onSubmit={handleSubmit((v) => {
                setServerError(null);
                mutation.mutate(v);
              })}
            >
              <div className="olg-field">
                <label className="olg-label" htmlFor="orphan-email">
                  {t("auth.email")}
                </label>
                <div className="olg-input-wrap">
                  <input
                    id="orphan-email"
                    type="email"
                    autoComplete="email"
                    className="olg-input"
                    {...register("email")}
                  />
                  <span className="olg-input-icon" aria-hidden="true">
                    <svg className="olg-icon" viewBox="0 0 24 24">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <polyline points="3 7 12 13 21 7" />
                    </svg>
                  </span>
                </div>
                {errors.email && (
                  <p className="olg-error" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="olg-field">
                <label className="olg-label" htmlFor="orphan-pw">
                  {t("auth.password")}
                </label>
                <div className="olg-input-wrap">
                  <input
                    id="orphan-pw"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="olg-input olg-input--password"
                    {...register("password")}
                  />
                  <span className="olg-input-icon" aria-hidden="true">
                    <svg className="olg-icon" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    className="olg-toggle-pw"
                    aria-label={t("auth.login.showPassword")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? (
                      <svg className="olg-icon olg-icon-sm" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="olg-icon olg-icon-sm" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="olg-error" role="alert">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {serverError && (
                <p className="olg-form-error" role="alert">
                  {serverError}
                </p>
              )}

              <button type="submit" className="olg-btn" disabled={isSubmitting}>
                {isSubmitting ? t("auth.submitting") : t("orphan.login.enter")}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
            </form>

            {/* Recovery guidance — routed through the guardian (child-safe) */}
            <div className="olg-help-card">
              <span className="olg-help-icon" aria-hidden="true">
                <svg className="olg-icon" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <p className="olg-help-text">
                <strong>{t("orphan.login.helpTitle")}</strong>
                {t("orphan.login.helpBody")}
              </p>
            </div>

            <p className="olg-help-line">
              <Link to="/forgot-password">{t("auth.forgotLink")}</Link>
            </p>
          </div>

          <div className="olg-footer">
            <LanguageSwitcher />
            <span>
              {t("orphan.login.secureFooter", { year: new Date().getFullYear() })}
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Friendly abstract eight-point star — no real children, decorative. */
function WelcomeStar() {
  return (
    <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="olgStar" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D6E6F2" />
          <stop offset="100%" stopColor="#B9D7EA" />
        </linearGradient>
        <linearGradient id="olgCore" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#EAF1F7" />
        </linearGradient>
      </defs>
      <circle cx="200" cy="200" r="180" fill="none" stroke="#9CC3DE" strokeWidth="1.5" strokeDasharray="4 8" opacity=".7" />
      <ellipse cx="100" cy="120" rx="60" ry="30" fill="white" opacity=".7" />
      <ellipse cx="300" cy="280" rx="80" ry="36" fill="white" opacity=".7" />
      <g transform="translate(200 200)">
        <g fill="url(#olgStar)" stroke="#769FCD" strokeWidth="1.5" strokeLinejoin="round">
          <polygon points="0,-70 18,-18 70,0 18,18 0,70 -18,18 -70,0 -18,-18" />
          <polygon points="0,-70 18,-18 70,0 18,18 0,70 -18,18 -70,0 -18,-18" transform="rotate(45)" />
        </g>
        <circle r="28" fill="url(#olgCore)" stroke="#769FCD" strokeWidth="1.5" />
        <text x="0" y="11" textAnchor="middle" fontFamily="IBM Plex Sans Arabic, sans-serif" fontSize="34" fontWeight="600" fill="#2D5683">
          ر
        </text>
      </g>
      <g fill="#769FCD">
        <circle cx="80" cy="280" r="4" />
        <circle cx="340" cy="100" r="5" />
        <circle cx="60" cy="200" r="3" />
        <circle cx="350" cy="180" r="3" />
      </g>
    </svg>
  );
}
