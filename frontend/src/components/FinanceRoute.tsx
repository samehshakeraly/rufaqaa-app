import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Wraps a page that should only be visible to finance staff and org
 * admins. Mirrors the server's FINANCE_ROLES guard. Renders a redirect
 * (back to the user's home) rather than a hard error — the user is
 * signed in but lacks the privilege.
 */
export function FinanceRoute({ children }: { children: ReactNode }) {
  const { isFinance, role, homePath } = useRole();

  // While the /me query hasn't loaded yet `role` is undefined; render
  // nothing rather than flashing a redirect.
  if (role === undefined) return null;
  if (!isFinance) return <Navigate to={homePath} replace />;
  return <>{children}</>;
}
