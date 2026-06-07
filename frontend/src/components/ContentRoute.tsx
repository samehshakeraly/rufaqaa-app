import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useRole } from "@/hooks/useRole";

/**
 * Gate for the orphan-intake surfaces — the orphan list, registration
 * and detail screens. Visible to every content manager: org admins and
 * partner staff/managers (isAdmin || isPartner), mirroring the server's
 * content-management tuples. Finance and marketing roles are signed in
 * but have no business on these screens, so they are redirected to their
 * own home rather than shown a hard error.
 *
 * The wider case-management surfaces (donors, families, orphanages,
 * partners, sponsorships, reports, executive dashboard) live behind
 * {@link FullContentRoute}, which additionally excludes the intake-only
 * partner_staff role.
 *
 * Usable two ways: as a wrapper around a single element (`children`) or
 * as a pathless layout route (falls back to <Outlet />). UI gate only;
 * the backend still enforces every privileged endpoint.
 */
export function ContentRoute({ children }: { children?: ReactNode }) {
  const { isAdmin, isPartner, role, homePath } = useRole();

  // While the /me query hasn't loaded yet `role` is undefined; render
  // nothing rather than flashing a redirect.
  if (role === undefined) return null;
  if (!(isAdmin || isPartner)) return <Navigate to={homePath} replace />;
  return <>{children ?? <Outlet />}</>;
}
