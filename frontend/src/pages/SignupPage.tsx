import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { donorSignup } from "@/lib/donorAuth";

export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = params.get("intent");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("KW");
  const [currency, setCurrency] = useState("KWD");
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [agreed, setAgreed] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      donorSignup({
        email,
        password,
        full_name: fullName,
        phone: phone || undefined,
        country_code: country || undefined,
        preferred_currency: currency || undefined,
        preferred_language: language,
      }),
    onSuccess: (data) => {
      // Preserve sponsor-intent across the email-verification round trip
      if (intent) sessionStorage.setItem("rufaqaa:postVerifyIntent", intent);
      // In dev mode the backend echoes the verification token; allow
      // tests to follow it without an email server.
      if (data.debug_verify_token) {
        sessionStorage.setItem(
          "rufaqaa:debugVerifyToken",
          data.debug_verify_token,
        );
      }
      navigate("/verify-email", { replace: true });
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? err.message
          : (err as Error).message;
      setServerError(String(msg));
    },
  });

  const passwordStrength =
    password.length === 0
      ? null
      : password.length < 8
        ? "weak"
        : /[A-Z]/.test(password) && /\d/.test(password)
          ? "strong"
          : "okay";

  return (
    <div className="mx-auto max-w-md">
      <div className="card space-y-5">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("signup.title")}
        </h1>
        {intent && (
          <p className="rounded-lg bg-tranquil/60 px-3 py-2 text-sm text-trust">
            {t("signup.sponsorIntent", { code: intent.replace("sponsor:", "") })}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setServerError(null);
            if (!agreed) {
              setServerError(t("signup.mustAccept"));
              return;
            }
            mut.mutate();
          }}
          className="space-y-3"
        >
          <Field label={t("signup.fullName")}>
            <input
              className="input"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <Field label={t("auth.email")}>
            <input
              type="email"
              className="input"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t("auth.password")}>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {passwordStrength && (
              <p
                className={`mt-1 text-xs ${
                  passwordStrength === "strong"
                    ? "text-emerald-700"
                    : passwordStrength === "okay"
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {t(`signup.strength.${passwordStrength}`)}
              </p>
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("signup.phone")}>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+96599000000"
              />
            </Field>
            <Field label={t("signup.country")}>
              <input
                className="input"
                maxLength={2}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label={t("signup.currency")}>
              <input
                className="input"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label={t("signup.language")}>
              <select
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value as "ar" | "en")}
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1"
            />
            <span>{t("signup.acceptTerms")}</span>
          </label>

          {serverError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {serverError}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={mut.isPending}
          >
            {mut.isPending ? t("auth.submitting") : t("signup.submit")}
          </button>

          <p className="text-center text-sm text-slate-600">
            {t("signup.haveAccount")}{" "}
            <Link to="/login" className="text-trust underline">
              {t("public.nav.login")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}
