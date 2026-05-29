import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

/**
 * Gate for the guardian self-portal. A user must:
 *   - have an access token (logged in)
 *   - hold role='guardian'
 *
 * Unlike {@link DonorRoute} this does NOT require a verified email:
 * guardians are provisioned by the partner organisation (their `email`
 * may be null entirely), so an email gate would lock every guardian out.
 * Staff are bounced to their admin dashboard; everyone else to home.
 */
export function GuardianRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const { role, isGuardian, isStaff } = useRole();

  if (!token) return <Navigate to="/login" replace />;
  if (role === undefined) return null;
  if (isStaff) return <Navigate to="/admin/dashboard" replace />;
  if (!isGuardian) return <Navigate to="/" replace />;
  return <>{children}</>;
}
