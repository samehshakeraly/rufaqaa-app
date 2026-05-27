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
  const isStaff =
    isAdmin ||
    role === "partner_manager" ||
    role === "partner_staff" ||
    role === "marketing_manager" ||
    role === "finance";
  const isDonor = role === "donor";
  const emailVerified = Boolean(data?.email_verified_at);

  return {
    role,
    isAdmin,
    isStaff,
    isDonor,
    emailVerified,
    /** Where to send this user when they hit `/` or just signed in. */
    homePath:
      isStaff ? "/admin/dashboard" : isDonor ? "/donor/dashboard" : "/",
  };
}
