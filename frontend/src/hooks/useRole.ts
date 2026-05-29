import { useCurrentUser } from "./useCurrentUser";

/**
 * Returns `(role) => boolean` style helpers. UI gating mirrors the
 * server's authz tuples — these are convenience checks, not security.
 * The backend still enforces every restricted action.
 */
export function useRole() {
  const { data } = useCurrentUser();
  const role = data?.role;

  const isAdmin = role === "super_admin" || role === "org_admin";
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
  const isGuardian = role === "guardian";
  const emailVerified = Boolean(data?.email_verified_at);

  return {
    role,
    isAdmin,
    isPartnerManager,
    isPartnerStaff,
    isPartner,
    isPartnerApprover,
    isStaff,
    isDonor,
    isGuardian,
    emailVerified,
    /** Where to send this user when they hit `/` or just signed in. */
    homePath: isStaff
      ? "/admin/dashboard"
      : isDonor
        ? "/donor/dashboard"
        : isGuardian
          ? "/guardian"
          : "/",
  };
}
