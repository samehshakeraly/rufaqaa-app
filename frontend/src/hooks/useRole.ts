import { useCurrentUser } from "./useCurrentUser";

/**
 * Returns `(role) => boolean` style helpers. UI gating mirrors the
 * server's authz tuples — these are convenience checks, not security.
 * The backend still enforces every restricted action.
 */
export function useRole() {
  const { data } = useCurrentUser();
  const role = data?.role;

  // Platform super-admin: manages tenants across the whole platform.
  // STRICTLY distinct from org_admin (which is scoped to a single org).
  // Gates the /platform/* super-admin portal — never grant to org_admin.
  const isSuperAdmin = role === "super_admin";
  const isAdmin = role === "super_admin" || role === "org_admin";
  // Finance + marketing gates mirror the server's FINANCE_ROLES /
  // MARKETING_ROLES tuples (each includes the admin roles). Admins see
  // every finance + marketing surface.
  const isMarketingManager = role === "marketing_manager";
  const isFinance = isAdmin || role === "finance";
  const isMarketing = isAdmin || isMarketingManager;
  const isPartnerManager = role === "partner_manager";
  const isPartnerStaff = role === "partner_staff";
  const isPartner = isPartnerManager || isPartnerStaff;
  // Anyone who can approve / reject orphans + moderate media + release.
  // Backend enforces tightening; this is the UI hint only.
  const isPartnerApprover = isAdmin || isPartnerManager;
  const isStaff =
    isAdmin ||
    isPartnerManager ||
    isPartnerStaff ||
    role === "marketing_manager" ||
    role === "finance";
  const isDonor = role === "donor";
  const isOrphan = role === "orphan";
  const emailVerified = Boolean(data?.email_verified_at);

  return {
    role,
    isSuperAdmin,
    isAdmin,
    isFinance,
    isMarketing,
    isMarketingManager,
    isPartnerManager,
    isPartnerStaff,
    isPartner,
    isPartnerApprover,
    isStaff,
    isDonor,
    isOrphan,
    emailVerified,
    /** Where to send this user when they hit `/` or just signed in. */
    homePath: isStaff
      ? "/admin/dashboard"
      : isDonor
        ? "/donor/dashboard"
        : isOrphan
          ? "/orphan"
          : "/",
  };
}
