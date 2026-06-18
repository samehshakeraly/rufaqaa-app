import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLogout } from "@/hooks/useLogout";
import { useRole } from "@/hooks/useRole";
import { getOrphanMe, isAgeGateError } from "@/lib/orphanSelf";
import { useAuthStore } from "@/store/auth";

/**
 * Gate for the orphan self-portal. A user must:
 *   - have an access token (logged in)
 *   - hold role='orphan'
 *
 * Anyone else is routed to a sensible alternative (anon → the orphan
 * login, staff/donor → their own home).
 *
 * Beyond the role check, the backend enforces a 12+ age gate on every
 * endpoint. We probe `/orphan/me` once: if it answers 403 AGE_GATE we
 * render a warm, age-appropriate message and withhold ALL portal content
 * (never a redirect to the public landing — this is a minor).
 */
export function OrphanRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const { role, isOrphan, isStaff, isDonor } = useRole();

  const meQuery = useQuery({
    queryKey: ["orphan", "me"],
    queryFn: getOrphanMe,
    enabled: Boolean(token) && isOrphan,
    // The age-gate 403 is a terminal answer, not a transient failure —
    // don't retry it (or any 4xx). Other errors get one retry.
    retry: (failureCount, error) =>
      !isAgeGateError(error) && failureCount < 1,
  });

  if (!token) return <Navigate to="/orphan/login" replace />;
  if (role === undefined) return null;
  if (isStaff) return <Navigate to="/admin/dashboard" replace />;
  if (isDonor) return <Navigate to="/donor/dashboard" replace />;
  if (!isOrphan) return <Navigate to="/" replace />;

  if (isAgeGateError(meQuery.error)) return <OrphanAgeGate />;
  // Hold paint until the probe resolves so we never flash portal content
  // before confirming the age gate.
  if (meQuery.isPending) return null;

  return <>{children}</>;
}

/** Warm, content-free screen shown to under-12 accounts. */
function OrphanAgeGate() {
  const { t } = useTranslation();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen flex-col bg-tranquil-100 dark:bg-gray-900">
      <div className="flex justify-end p-4">
        <LanguageSwitcher />
      </div>
      <main
        role="main"
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 pb-16 text-center"
      >
        <div
          aria-hidden="true"
          className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-trust-100 text-5xl"
        >
          🌱
        </div>
        <h1 className="text-2xl font-bold text-trust-700 dark:text-trust-100">
          {t("orphan.ageGate.title")}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-gray-700 dark:text-gray-200">
          {t("orphan.ageGate.body")}
        </p>
        <button
          type="button"
          onClick={() => logout("/orphan/login")}
          className="btn-primary mt-8"
        >
          {t("nav.logout")}
        </button>
      </main>
    </div>
  );
}
