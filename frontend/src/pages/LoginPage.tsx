import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { type ReactElement, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { login } from "@/lib/auth";
import { isTokenValid, useAuthStore } from "@/store/auth";

import "./LoginPage.css";

function buildSchema(t: (k: string) => string) {
  return z.object({
    email: z.string().email(t("auth.invalidEmail")),
    password: z.string().min(8, t("auth.passwordTooShort")),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

// Cosmetic role tabs — they only re-skin the greeting copy. They have no
// bearing on authentication: the role is resolved server-side from the
// account, and the post-login redirect is dispatched by the root route.
const ROLES = ["guardian", "donor", "partner", "admin"] as const;
type Role = (typeof ROLES)[number];

const ROLE_ICONS: Record<Role, ReactElement> = {
  guardian: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  ),
  donor: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21.02 7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  partner: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

export function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useLocation();
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const clearTokens = useAuthStore((s) => s.clear);
  const [serverError, setServerError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("donor");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(buildSchema(t)),
    defaultValues: { email: "admin@dev.rufaqaa.app", password: "" },
  });

  const mutation = useMutation({
    mutationFn: (v: FormValues) => login(v.email, v.password),
    onSuccess: (data) => {
      // Drop any prior user's cached queries before this session begins, so a
      // re-login never surfaces the previous account's data (notably the
      // /auth/me response behind useCurrentUser/useRole).
      qc.clear();
      setTokens(data.access_token, data.refresh_token);
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
      // Land on `/` — the root route dispatches by role (admin →
      // /admin/dashboard, donor → /donor/dashboard, else landing).
      navigate(from ?? "/", { replace: true });
    },
    onError: (err) => {
      if (err instanceof AxiosError && err.response?.status === 401) {
        setServerError(t("auth.invalidCredentials"));
      } else {
        setServerError(t("auth.serverError"));
      }
    },
  });

  // A persisted token is only a reason to redirect if it's actually
  // usable. A stale/expired token must NOT bounce the login page (the bug
  // this guards against): proactively clear it so the form renders and
  // api.ts doesn't need a 401 round-trip to discard it.
  const hasValidToken = isTokenValid(token);
  useEffect(() => {
    if (token && !hasValidToken) {
      clearTokens();
    }
  }, [token, hasValidToken, clearTokens]);

  if (hasValidToken) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="lg-root">
      <div className="lg-lang">
        <LanguageSwitcher />
      </div>

      <div className="lg-screen">
        {/* ═══ FORM ═══ */}
        <div className="lg-form-side">
          <div className="lg-form-wrap">
            <div className="lg-logo">
              <div className="lg-logo-mark" aria-hidden="true">
                ر
              </div>
              <div className="lg-logo-text">
                <h1>{t("auth.login.brandName")}</h1>
                <p>{t("auth.login.brandTagline")}</p>
              </div>
            </div>

            <div className="lg-greeting">
              <h2>{t(`auth.login.greeting.${role}.title`)}</h2>
              <p>{t(`auth.login.greeting.${role}.sub`)}</p>
            </div>

            {/* Role selector — cosmetic, re-skins the greeting only. */}
            <div className="lg-role-pills" role="tablist" aria-label={t("auth.login.rolesLabel")}>
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={r === role}
                  className={`lg-role-pill${r === role ? " active" : ""}`}
                  onClick={() => setRole(r)}
                >
                  {ROLE_ICONS[r]}
                  {t(`auth.login.roles.${r}`)}
                </button>
              ))}
            </div>

            <form
              className="lg-form"
              onSubmit={handleSubmit((v) => {
                setServerError(null);
                mutation.mutate(v);
              })}
            >
              <div className="lg-field">
                <label htmlFor="login-email">{t("auth.email")}</label>
                <div className="lg-field-input-wrap">
                  <input
                    id="login-email"
                    type="email"
                    className="lg-input lg-latin"
                    placeholder={t("auth.login.emailPlaceholder")}
                    autoComplete="email"
                    {...register("email")}
                  />
                  <span className="lg-field-icon" aria-hidden="true">
                    <svg className="lg-icon lg-icon-sm" viewBox="0 0 24 24">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </span>
                </div>
                {errors.email && <p className="lg-field-error">{errors.email.message}</p>}
              </div>

              <div className="lg-field">
                <label htmlFor="login-password">{t("auth.password")}</label>
                <div className="lg-field-input-wrap">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    className="lg-input lg-input--password lg-latin"
                    placeholder={t("auth.login.passwordPlaceholder")}
                    autoComplete="current-password"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    className="lg-field-eye"
                    aria-label={t("auth.login.showPassword")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? (
                      <svg className="lg-icon lg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="lg-icon lg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                  <span className="lg-field-icon" aria-hidden="true">
                    <svg className="lg-icon lg-icon-sm" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                </div>
                {errors.password && <p className="lg-field-error">{errors.password.message}</p>}
              </div>

              <div className="lg-field-row">
                <label className="lg-remember">
                  <input
                    type="checkbox"
                    className="lg-remember-input"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span className="lg-remember-box" aria-hidden="true" />
                  {t("auth.login.remember")}
                </label>
                <Link to="/forgot-password" className="lg-forgot-link">
                  {t("auth.forgotLink")}
                </Link>
              </div>

              {serverError && <p className="lg-form-error">{serverError}</p>}

              <button type="submit" className="lg-btn-submit" disabled={isSubmitting}>
                {isSubmitting ? t("auth.submitting") : t("auth.login.loginButton")}
                <svg className="lg-icon lg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </form>

            <div className="lg-or-divider">{t("auth.login.or")}</div>

            <div className="lg-social-buttons">
              <button type="button" className="lg-social-btn" disabled title={t("common.comingSoon")} aria-label={t("auth.login.continueWithGoogle")}>
                <span className="lg-logo-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
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
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                </span>
                Google
              </button>
              <button type="button" className="lg-social-btn" disabled title={t("common.comingSoon")} aria-label={t("auth.login.continueWithApple")}>
                <span className="lg-logo-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M17.6 12.7c0-2.1 1.7-3.1 1.7-3.1-.9-1.4-2.4-1.5-2.9-1.5-1.2-.1-2.4.7-3 .7s-1.5-.7-2.5-.7c-1.3 0-2.5.7-3.1 1.9-1.4 2.3-.4 5.8 1 7.7.7.9 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6s1.5.6 2.5.6 1.7-.9 2.3-1.8c.7-1 1-2 1-2 0-.1-2-.7-2-3.2zM15.7 6.8c.5-.6.9-1.5.8-2.3-.8 0-1.7.5-2.2 1.1-.5.5-.9 1.4-.8 2.2.8.1 1.7-.4 2.2-1z" />
                  </svg>
                </span>
                Apple
              </button>
            </div>

            <div className="lg-register-link">
              {t("auth.login.noAccount")}
              <Link to="/signup">{t("auth.login.signupCta")}</Link>
            </div>

            <div className="lg-help-row">
              <svg className="lg-icon lg-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                <strong>{t("auth.login.help.title")}</strong> {t("auth.login.help.before")}{" "}
                <Link to="/contact">{t("auth.login.help.contact")}</Link> {t("auth.login.help.after")}
              </span>
            </div>
          </div>
        </div>

        {/* ═══ ILLUSTRATION (decorative, hidden ≤1024px) ═══ */}
        <div className="lg-illustration" aria-hidden="true">
          <div className="lg-illustration-orbit" />

          <div className="lg-illustration-stat lg-stat-orphans">
            <div className="lg-illustration-stat-num lg-num">12,840</div>
            <div className="lg-illustration-stat-label">{t("auth.login.illustration.stats.orphans")}</div>
          </div>
          <div className="lg-illustration-stat lg-stat-donors">
            <div className="lg-illustration-stat-num lg-num">8,920</div>
            <div className="lg-illustration-stat-label">{t("auth.login.illustration.stats.donors")}</div>
          </div>
          <div className="lg-illustration-stat lg-stat-orgs">
            <div className="lg-illustration-stat-num lg-num">47</div>
            <div className="lg-illustration-stat-label">{t("auth.login.illustration.stats.orgs")}</div>
          </div>
          <div className="lg-illustration-stat lg-stat-countries">
            <div className="lg-illustration-stat-num lg-num">14</div>
            <div className="lg-illustration-stat-label">{t("auth.login.illustration.stats.countries")}</div>
          </div>

          <div className="lg-illustration-top">
            <span className="lg-illustration-eyebrow">
              <span className="lg-dot" />
              {t("auth.login.illustration.eyebrowBefore")}{" "}
              <span className="lg-num" style={{ margin: "0 3px" }}>
                {t("auth.login.illustration.eyebrowCount")}
              </span>{" "}
              {t("auth.login.illustration.eyebrowAfter")}
            </span>
          </div>

          <div className="lg-illustration-bottom">
            <h3>{t("auth.login.illustration.headline")}</h3>

            <blockquote className="lg-verse">
              {t("auth.login.illustration.verse")}
              <span className="lg-verse-attr">{t("auth.login.illustration.verseAttr")}</span>
            </blockquote>

            <div className="lg-partner-strip">
              <div className="lg-partner-strip-label">{t("auth.login.illustration.partnersLabel")}</div>
              <div className="lg-partner-logos">
                <span className="lg-partner-logo">
                  <span className="lg-mark">فجر</span>
                  {t("auth.login.illustration.partners.fajr")}
                </span>
                <span className="lg-partner-logo">
                  <span className="lg-mark">أمل</span>
                  {t("auth.login.illustration.partners.amal")}
                </span>
                <span className="lg-partner-logo">
                  <span className="lg-mark">كرم</span>
                  {t("auth.login.illustration.partners.karam")}
                </span>
                <span className="lg-partner-logo">
                  <span className="lg-mark">إحس</span>
                  {t("auth.login.illustration.partners.ihsan")}
                </span>
                <span className="lg-partner-logo" style={{ color: "var(--gray-500)" }}>
                  + <span className="lg-num">43</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
