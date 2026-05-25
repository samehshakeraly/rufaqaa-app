import MockAdapter from "axios-mock-adapter";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

describe("api 401 → refresh → retry", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    useAuthStore.setState({ accessToken: "old", refreshToken: "r-1" });
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
    useAuthStore.setState({ accessToken: null, refreshToken: null });
    vi.restoreAllMocks();
  });

  it("refreshes once and retries the original call", async () => {
    mock
      .onGet("/orphans")
      .replyOnce(401, { detail: "Invalid" })
      .onGet("/orphans")
      .replyOnce(200, { ok: true });

    const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
      data: { access_token: "new-access", refresh_token: "r-2" },
      status: 200,
      statusText: "OK",
      headers: {},
      config: {} as never,
    });

    const r = await api.get("/orphans");
    expect(r.status).toBe(200);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe("new-access");
    expect(useAuthStore.getState().refreshToken).toBe("r-2");
  });

  it("clears tokens when refresh itself fails", async () => {
    mock.onGet("/orphans").reply(401, { detail: "Invalid" });
    vi.spyOn(axios, "post").mockRejectedValue(new Error("nope"));

    await expect(api.get("/orphans")).rejects.toBeTruthy();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it("does not retry refresh itself on 401", async () => {
    mock.onGet("/orphans").reply(401, { detail: "Invalid" });
    // simulate refresh endpoint also returning 401
    const postSpy = vi.spyOn(axios, "post").mockRejectedValue({
      response: { status: 401, data: { detail: "Refresh dead" } },
    });

    await expect(api.get("/orphans")).rejects.toBeTruthy();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
