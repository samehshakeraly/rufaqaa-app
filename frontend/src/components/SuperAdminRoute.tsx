import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Wraps a page that should only be visible to the platform `super_admin`.
 * Mirrors the server's super-admin-only guard on `/platform/*` and
 * `/stats/platform/*`. This is STRICTLY narrower than {@link AdminRoute}:
 * an org_admin is an admin but NOT a super_admin, and must be redirected
 * away from the platform portal.
 *
 * We render a graceful redirect (to the user's home) rather than a hard
 * 403 — the user is signed in but lacks the privilege.
 */
export function SuperAdminRoute({ children }: { children: ReactNode }) {
  const { isSuperAdmin, role, homePath } = useRole();

  // While the /me query hasn't loaded yet `role` is undefined; render
  // nothing rather than flashing a redirect.
  if (role === undefined) return null;
  if (!isSuperAdmin) return <Navigate to={homePath} replace />;
  return <>{children}</>;
}
