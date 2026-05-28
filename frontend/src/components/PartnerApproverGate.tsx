import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Wraps a page that should only be visible to partner-approver roles
 * (super_admin, org_admin, partner_manager). UI gate only — backend
 * still enforces every privileged endpoint.
 */
export function PartnerApproverGate({ children }: { children: ReactNode }) {
  const { isPartnerApprover, role } = useRole();
  if (role === undefined) return null;
  if (!isPartnerApprover) return <Navigate to="/admin/dashboard" replace />;
  return <>{children}</>;
}
