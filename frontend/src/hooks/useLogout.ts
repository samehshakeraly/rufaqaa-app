import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthStore } from "../store/auth";

/**
 * Centralised logout. Returns a stable `logout(redirectTo?)` callback that,
 * IN THIS ORDER:
 *   1. clears the auth store (drops the persisted tokens),
 *   2. wipes the entire React Query cache,
 *   3. redirects (default `/login`; pass a portal-specific login path where
 *      that differs, e.g. `/orphan/login`, `/guardian/login`).
 *
 * Step 2 is the fix for the stale-session bug: the module-scoped
 * QueryClient (staleTime 30s) otherwise retains the previous user's queries
 * — notably the `/auth/me` response behind useCurrentUser/useRole — across a
 * logout → login-as-different-user swap, so the next user saw the prior
 * user's portal until a manual refresh. Clearing the cache here (and on
 * login) guarantees a clean session.
 *
 * NOTE: the QueryClient is obtained via useQueryClient() from within the
 * component tree — it is deliberately NOT exported from main.tsx. The silent
 * token-refresh / 401 path in lib/api.ts must NOT clear the cache (that is
 * the SAME user), so it is left untouched.
 */
export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  return useCallback(
    (redirectTo?: string) => {
      useAuthStore.getState().clear();
      qc.clear();
      navigate(redirectTo ?? "/login", { replace: true });
    },
    [qc, navigate],
  );
}
