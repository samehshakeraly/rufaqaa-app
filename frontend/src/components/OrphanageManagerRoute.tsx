import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

/**
 * Gate for the orphanage-manager portal. A user must:
 *   - have an access token (logged in)
 *   - hold role='orphanage_manager'
 *
 * Anyone else is routed to the closest sensible alternative — anon to the
 * shared login, staff/donor/orphan/guardian to their own home. Mirrors
 * `GuardianRoute`; the backend resource itself is the real gate (every
 * /orphanage/me* endpoint 404s for non-managers), so this is a UI
 * convenience, not a security boundary.
 *
 * We hold paint until `role` resolves so we never flash a redirect before the
 * profile loads — important because the manager home (`/orphanage-manager`) is
 * the landing target for this role and a premature bounce would loop.
 */
export function OrphanageManagerRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const { role, isOrphanageManager, isStaff, isDonor, isOrphan, isGuardian } = useRole();

  if (!token) return <Navigate to="/login" replace />;
  if (role === undefined) return null;
  if (isStaff) return <Navigate to="/admin/dashboard" replace />;
  if (isDonor) return <Navigate to="/donor/dashboard" replace />;
  if (isOrphan) return <Navigate to="/orphan" replace />;
  if (isGuardian) return <Navigate to="/guardian" replace />;
  if (!isOrphanageManager) return <Navigate to="/" replace />;
  return <>{children}</>;
}
