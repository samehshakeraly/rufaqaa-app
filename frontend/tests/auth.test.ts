import { describe, expect, it, beforeEach } from "vitest";

import { isAccessTokenValid, isTokenValid, useAuthStore } from "@/store/auth";

// Builds an unsigned JWT (header.payload.signature) carrying the given
// claims — enough for the client-side `exp` decode under test.
function makeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.sig`;
}

describe("auth store", () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });

  it("stores and clears tokens", () => {
    useAuthStore.getState().setTokens("a-token", "r-token");
    expect(useAuthStore.getState().accessToken).toBe("a-token");
    expect(useAuthStore.getState().refreshToken).toBe("r-token");

    useAuthStore.getState().clear();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});

describe("isTokenValid", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const past = Math.floor(Date.now() / 1000) - 3600;

  it("treats a missing token as invalid", () => {
    expect(isTokenValid(null)).toBe(false);
    expect(isTokenValid(undefined)).toBe(false);
    expect(isTokenValid("")).toBe(false);
  });

  it("treats an unexpired token as valid", () => {
    expect(isTokenValid(makeJwt({ exp: future }))).toBe(true);
  });

  it("treats an expired token as invalid", () => {
    expect(isTokenValid(makeJwt({ exp: past }))).toBe(false);
  });

  it("treats a token with no exp claim as invalid", () => {
    expect(isTokenValid(makeJwt({ sub: "u1" }))).toBe(false);
  });

  it("treats a garbage / undecodable token as invalid", () => {
    expect(isTokenValid("not-a-jwt")).toBe(false);
    expect(isTokenValid("a.b.c")).toBe(false);
  });
});

describe("isAccessTokenValid", () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });

  it("reflects the persisted access token's validity", () => {
    expect(isAccessTokenValid()).toBe(false);

    const exp = Math.floor(Date.now() / 1000) + 3600;
    useAuthStore.getState().setTokens(makeJwt({ exp }), "r-token");
    expect(isAccessTokenValid()).toBe(true);

    const expired = Math.floor(Date.now() / 1000) - 1;
    useAuthStore.getState().setTokens(makeJwt({ exp: expired }), "r-token");
    expect(isAccessTokenValid()).toBe(false);
  });
});
