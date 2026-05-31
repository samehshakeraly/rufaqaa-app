import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh }),
      clear: () => set({ accessToken: null, refreshToken: null }),
    }),
    { name: "rufaqaa.auth" },
  ),
);

/**
 * Reads the `exp` claim from a JWT WITHOUT verifying its signature.
 *
 * This is a client-side convenience only: it lets the redirect guards on
 * /login and / avoid acting on a token that is obviously stale (so a
 * persisted-but-expired token doesn't bounce the login page before any
 * API call gets the chance to clear it via the 401 interceptor). The
 * server still validates every token on every request — never treat this
 * as a security check.
 *
 * Returns the expiry as a UNIX-seconds number, or null if the token is
 * malformed or carries no numeric `exp`.
 */
function readJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // JWT uses base64url; map it back to standard base64 before decoding.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * A token is usable only if it exists AND is not expired. Anything we
 * can't decode (or that lacks a numeric `exp`) is treated as invalid so
 * the guards fail safe toward showing the login form rather than looping.
 */
export function isTokenValid(token: string | null | undefined): boolean {
  if (!token) return false;
  const exp = readJwtExp(token);
  if (exp === null) return false;
  return exp * 1000 > Date.now();
}

/** Convenience wrapper for callers outside React (e.g. interceptors). */
export function isAccessTokenValid(): boolean {
  return isTokenValid(useAuthStore.getState().accessToken);
}
