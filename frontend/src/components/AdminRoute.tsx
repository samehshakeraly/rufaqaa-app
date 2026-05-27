import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Wraps a page that should only be visible to org admins. We render a
 * redirect (back to the dashboard) rather than a hard error — the user
 * is signed in but lacks the privilege.
 */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, role, homePath } = useRole();

  // While the /me query hasn't loaded yet `role` is undefined; render
  // nothing rather than flashing a redirect.
  if (role === undefined) return null;
  if (!isAdmin) return <Navigate to={homePath} replace />;
  return <>{children}</>;
}
