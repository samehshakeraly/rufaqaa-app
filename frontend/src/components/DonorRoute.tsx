import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";

/**
 * Gate for donor-area pages. A user must:
 *   - have an access token (logged in)
 *   - hold role='donor'
 *   - have a verified email address
 *
 * Anyone else gets routed to the closest sensible alternative — anon
 * to /login, staff to their admin dashboard, unverified donor to the
 * verify-email pending page.
 */
export function DonorRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const { role, isDonor, isStaff, emailVerified } = useRole();

  if (!token) return <Navigate to="/login" replace />;
  if (role === undefined) return null;
  if (isStaff) return <Navigate to="/admin/dashboard" replace />;
  if (!isDonor) return <Navigate to="/" replace />;
  if (!emailVerified) return <Navigate to="/verify-email" replace />;
  return <>{children}</>;
}
