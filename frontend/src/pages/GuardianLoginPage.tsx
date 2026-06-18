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

import "./GuardianLoginPage.css";

function buildSchema(t: (k: string) => string) {
  return z.object({
    email: z.string().email(t("auth.invalidEmail")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** G-01 — sign-in for the guardian family portal. Same unified auth as the
 * other portals (POST /auth/login with email + password); on success the
 * guardian lands on their home. The mockup shows a phone field, but the real
 * platform auth is email + password (shared with /login and the orphan
 * portal), so this screen mirrors that. No financial or donor data appears. */
export function GuardianLoginPage() {
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
      navigate("/guardian", { replace: true });
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
    return <Navigate to="/guardian" replace />;
  }

  return (
    <div className="glog-root">
      <div className="glog-page">
        {/* Illustration / inspiration (left in RTL) */}
        <section className="glog-illu" aria-hidden="true">
          <div className="glog-illu-content">
            <blockquote className="glog-quote">
              <span className="glog-quote-mark">”</span>
              <p className="glog-quote-text">{t("guardian.login.quote")}</p>
              <cite className="glog-quote-source">
                {t("guardian.login.quoteSource")}
              </cite>
            </blockquote>
          </div>
        </section>

        {/* Form (right in RTL) */}
        <main className="glog-form-panel" role="main">
          <div className="glog-brand">
            <span className="glog-brand-mark" aria-hidden="true">
              ر
            </span>
            <div className="glog-brand-text">
              <h1>{t("auth.login.brandName")}</h1>
              <p>{t("guardian.layout.portalName")}</p>
            </div>
          </div>

          <div className="glog-form-inner">
            <div className="glog-form-head">
              <h2 className="glog-form-title">{t("guardian.login.title")}</h2>
              <p className="glog-form-sub">{t("guardian.login.subtitle")}</p>
            </div>

            <form
              onSubmit={handleSubmit((v) => {
                setServerError(null);
                mutation.mutate(v);
              })}
            >
              <div className="glog-field">
                <label className="glog-label" htmlFor="guardian-email">
                  {t("auth.email")}
                </label>
                <div className="glog-input-wrap">
                  <input
                    id="guardian-email"
                    type="email"
                    autoComplete="email"
                    className="glog-input"
                    {...register("email")}
                  />
                  <span className="glog-input-icon" aria-hidden="true">
                    <svg className="glog-icon" viewBox="0 0 24 24">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <polyline points="3 7 12 13 21 7" />
                    </svg>
                  </span>
                </div>
                {errors.email && (
                  <p className="glog-error" role="alert">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="glog-field">
                <label className="glog-label" htmlFor="guardian-pw">
                  {t("auth.password")}
                </label>
                <div className="glog-input-wrap">
                  <input
                    id="guardian-pw"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="glog-input glog-input--password"
                    {...register("password")}
                  />
                  <span className="glog-input-icon" aria-hidden="true">
                    <svg className="glog-icon" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    className="glog-toggle-pw"
                    aria-label={t("auth.login.showPassword")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? (
                      <svg className="glog-icon glog-icon-sm" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="glog-icon glog-icon-sm" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="glog-error" role="alert">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {serverError && (
                <p className="glog-form-error" role="alert">
                  {serverError}
                </p>
              )}

              <button type="submit" className="glog-btn" disabled={isSubmitting}>
                {isSubmitting ? t("auth.submitting") : t("guardian.login.enter")}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
            </form>

            {/* Recovery guidance — guardians who haven't received credentials */}
            <div className="glog-help-card">
              <span className="glog-help-icon" aria-hidden="true">
                <svg className="glog-icon" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <p className="glog-help-text">
                <strong>{t("guardian.login.helpTitle")}</strong>
                {t("guardian.login.helpBody")}
              </p>
            </div>

            <p className="glog-help-line">
              <Link to="/forgot-password">{t("auth.forgotLink")}</Link>
            </p>
          </div>

          <div className="glog-footer">
            <LanguageSwitcher />
            <span>
              {t("guardian.login.secureFooter", {
                year: new Date().getFullYear(),
              })}
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
