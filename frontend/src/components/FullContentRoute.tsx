import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Narrower sibling of {@link ContentRoute} for the case-management
 * surfaces that intake staff must NOT reach — the executive dashboard,
 * donors, families, orphanages, partners, sponsorships and orphan
 * reports. Visible to org admins and partner_manager
 * (isAdmin || isPartnerManager).
 *
 * partner_staff (field researchers) are confined to orphan intake, so
 * they are redirected to their own home (the جهة-scoped orphan list)
 * rather than shown these screens. Finance and marketing roles — signed
 * in but with no business here — are likewise redirected home, exactly as
 * ContentRoute already did for them.
 *
 * Usable two ways: as a wrapper around a single element (`children`) or
 * as a pathless layout route (falls back to <Outlet />). UI gate only;
 * the backend still enforces every privileged endpoint.
 */
export function FullContentRoute({ children }: { children?: ReactNode }) {
  const { isAdmin, isPartnerManager, role, homePath } = useRole();

  // While the /me query hasn't loaded yet `role` is undefined; render
  // nothing rather than flashing a redirect.
  if (role === undefined) return null;
  if (!(isAdmin || isPartnerManager)) return <Navigate to={homePath} replace />;
  return <>{children ?? <Outlet />}</>;
}
