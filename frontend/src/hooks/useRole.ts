import { useCurrentUser } from "./useCurrentUser";

/**
 * Returns `(role) => boolean` style helpers. UI gating mirrors the
 * server's authz tuples — these are convenience checks, not security.
 * The backend still enforces every restricted action.
 */
export function useRole() {
  const { data } = useCurrentUser();
  const role = data?.role;

  return {
    role,
    isAdmin: role === "super_admin" || role === "org_admin",
    isStaff:
      role === "super_admin" ||
      role === "org_admin" ||
      role === "partner_manager" ||
      role === "partner_staff" ||
      role === "marketing_manager" ||
      role === "finance",
  };
}
