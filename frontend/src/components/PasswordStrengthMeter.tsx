import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import "./PasswordStrengthMeter.css";

// Shared strength meter + 4 live checks. Extracted from SignupPage so the
// signup and password-reset (A-03) flows share one implementation. The
// i18n keys live under `signup.*` (strengthLabel / strengthLevels / checks).

interface PasswordChecks {
  length: boolean;
  digit: boolean;
  upper: boolean;
  symbol: boolean;
}

// The 4 live checks that drive the meter.
function evaluatePasswordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    digit: /\d/.test(password),
    upper: /[A-Z]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
}

const STRENGTH_CLASS = ["", "weak", "ok", "good", "strong"] as const;
const STRENGTH_KEY = ["", "weak", "ok", "good", "strong"] as const;
const CHECK_KEYS = ["length", "digit", "upper", "symbol"] as const;

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  const checks = useMemo(() => evaluatePasswordChecks(password), [password]);
  const score = Object.values(checks).filter(Boolean).length;

  return (
    <div className="psm">
      <div className="psm-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`psm-bar${i <= score ? ` ${STRENGTH_CLASS[score]}` : ""}`}
          />
        ))}
      </div>
      <div className="psm-label">
        {score === 0
          ? t("signup.strengthLabel")
          : t(`signup.strengthLevels.${STRENGTH_KEY[score]}`)}
      </div>
      <div className="psm-checks">
        {CHECK_KEYS.map((c) => (
          <span key={c} className={`psm-check${checks[c] ? " ok" : ""}`}>
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
            {t(`signup.checks.${c}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
