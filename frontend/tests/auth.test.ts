import { describe, expect, it, beforeEach } from "vitest";

import { useAuthStore } from "@/store/auth";

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
