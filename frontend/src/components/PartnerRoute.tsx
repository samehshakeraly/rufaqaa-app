import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Gate for the partner-manager portal (/partner/*). Visible to the
 * partner-approver roles — super_admin, org_admin and partner_manager
 * — mirroring the server's approver tuple. partner_staff is signed in
 * but lacks the manager privilege, so it is redirected home rather than
 * shown a hard error. UI gate only; the backend still enforces every
 * privileged endpoint.
 */
export function PartnerRoute({ children }: { children: ReactNode }) {
  const { isPartnerApprover, role, homePath } = useRole();

  // While the /me query hasn't loaded yet `role` is undefined; render
  // nothing rather than flashing a redirect.
  if (role === undefined) return null;
  if (!isPartnerApprover) return <Navigate to={homePath} replace />;
  return <>{children}</>;
}
