import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { verifyEmail } from "@/lib/donorAuth";
import { useAuthStore } from "@/store/auth";

/** Landing target of the verification link from the email body. */
export function VerifyEmailConfirmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const mut = useMutation({
    mutationFn: () => verifyEmail(token),
    onSuccess: (pair) => {
      setTokens(pair.access_token, pair.refresh_token);
      const intent = sessionStorage.getItem("rufaqaa:postVerifyIntent");
      if (intent?.startsWith("sponsor:")) {
        sessionStorage.removeItem("rufaqaa:postVerifyIntent");
        const code = intent.slice("sponsor:".length);
        navigate(`/sponsor/${code}/checkout`, { replace: true });
      } else {
        navigate("/donor/dashboard", { replace: true });
      }
    },
  });

  useEffect(() => {
    if (token && !mut.isPending && !mut.isSuccess && !mut.isError) {
      mut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="card space-y-3 text-center">
        {!token && (
          <p className="text-sm text-red-700">{t("verifyConfirm.missing")}</p>
        )}
        {mut.isPending && <p className="text-sm text-slate-600">{t("verifyConfirm.checking")}</p>}
        {mut.isError && (
          <>
            <div className="text-5xl">⚠️</div>
            <h1 className="text-2xl font-bold text-red-700">
              {t("verifyConfirm.failed")}
            </h1>
            <p className="text-sm text-slate-600">{t("verifyConfirm.failedBody")}</p>
            <Link to="/verify-email" className="block text-sm text-trust underline">
              {t("verifyPending.didntGet")}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
