import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

/**
 * Gate for the guardian family portal. A user must:
 *   - have an access token (logged in)
 *   - hold role='guardian'
 *
 * Anyone else is routed to the closest sensible alternative — anon to the
 * guardian login, staff/donor/orphan to their own home. Mirrors
 * `OrphanRoute` / `DonorRoute`; the backend resource itself is the real gate
 * (every /guardian/me* endpoint 404s for non-guardian users), so this is a
 * UI convenience, not a security boundary.
 *
 * We hold paint until `role` resolves so we never flash a redirect before the
 * profile loads — important because the guardian home (`/guardian`) is the
 * landing target for this role and a premature bounce would loop.
 */
export function GuardianRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const { role, isGuardian, isStaff, isDonor, isOrphan } = useRole();

  if (!token) return <Navigate to="/guardian/login" replace />;
  if (role === undefined) return null;
  if (isStaff) return <Navigate to="/admin/dashboard" replace />;
  if (isDonor) return <Navigate to="/donor/dashboard" replace />;
  if (isOrphan) return <Navigate to="/orphan" replace />;
  if (!isGuardian) return <Navigate to="/" replace />;
  return <>{children}</>;
}
