import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { verifyEmail } from "@/lib/donorAuth";
import { useAuthStore } from "@/store/auth";

import {
  AlertIcon,
  BrandMark,
  CheckIcon,
  ChevronStart,
} from "./verifyEmailChrome";
import "./VerifyEmailPage.css";

/** Landing target of the verification link from the email body. */
export function VerifyEmailConfirmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  // Where to send the freshly-verified donor — preserves a pending
  // sponsor intent across the verification round trip, else the
  // dashboard. Reused by the success "continue" button below.
  function proceed() {
    const intent = sessionStorage.getItem("rufaqaa:postVerifyIntent");
    if (intent?.startsWith("sponsor:")) {
      sessionStorage.removeItem("rufaqaa:postVerifyIntent");
      const code = intent.slice("sponsor:".length);
      navigate(`/sponsor/${code}/checkout`, { replace: true });
    } else {
      navigate("/donor/dashboard", { replace: true });
    }
  }

  const mut = useMutation({
    mutationFn: () => verifyEmail(token),
    onSuccess: (pair) => {
      setTokens(pair.access_token, pair.refresh_token);
    },
  });

  useEffect(() => {
    if (token && !mut.isPending && !mut.isSuccess && !mut.isError) {
      mut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
          {/* ── Missing token ── */}
          {!token && (
            <div className="ve-status">
              <div
                className="ve-status-icon ve-status-icon--error"
                aria-hidden="true"
              >
                <AlertIcon />
              </div>
              <h1>{t("verifyConfirm.failed")}</h1>
              <p>{t("verifyConfirm.missing")}</p>
              <Link to="/verify-email" className="ve-link">
                {t("verifyPending.didntGet")}
              </Link>
            </div>
          )}

          {/* ── Verifying ── */}
          {token && mut.isPending && (
            <div className="ve-status">
              <div className="ve-status-icon ve-status-icon--info">
                <div className="ve-spinner" role="status" aria-live="polite" />
              </div>
              <p>{t("verifyConfirm.checking")}</p>
            </div>
          )}

          {/* ── Success ── */}
          {token && mut.isSuccess && (
            <div className="ve-status">
              <div
                className="ve-status-icon ve-status-icon--success"
                aria-hidden="true"
              >
                <CheckIcon />
              </div>
              <h1>{t("verifyConfirm.success.title")}</h1>
              <p>{t("verifyConfirm.success.body")}</p>
              <button
                type="button"
                className="ve-btn ve-btn-primary"
                onClick={proceed}
              >
                {t("verifyConfirm.continue")}
              </button>
            </div>
          )}

          {/* ── Error ── */}
          {token && mut.isError && (
            <div className="ve-status">
              <div
                className="ve-status-icon ve-status-icon--error"
                aria-hidden="true"
              >
                <AlertIcon />
              </div>
              <h1>{t("verifyConfirm.failed")}</h1>
              <p>{t("verifyConfirm.failedBody")}</p>
              <Link to="/verify-email" className="ve-link">
                {t("verifyPending.didntGet")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
