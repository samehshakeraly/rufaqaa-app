import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import { listPartners } from "@/lib/partners";

const EMPTY_PAGE = { items: [], total: 0, limit: 100, offset: 0 };

describe("listPartners query serialization", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("sends limit + include_inactive, and omits country_code by default", async () => {
    mock.onGet("/partners").reply(200, EMPTY_PAGE);

    await listPartners();

    const params = mock.history.get[0]?.params as Record<string, unknown>;
    expect(params.limit).toBe(100);
    expect(params.include_inactive).toBe(false);
    // No country filter unless one is passed — never sent as undefined.
    expect("country_code" in params).toBe(false);
  });

  it("passes include_inactive through positionally", async () => {
    mock.onGet("/partners").reply(200, EMPTY_PAGE);

    await listPartners(true);

    const params = mock.history.get[0]?.params as Record<string, unknown>;
    expect(params.include_inactive).toBe(true);
    expect("country_code" in params).toBe(false);
  });

  it("sends country_code only when provided", async () => {
    mock.onGet("/partners").reply(200, EMPTY_PAGE);

    await listPartners(false, "EG");

    const params = mock.history.get[0]?.params as Record<string, unknown>;
    expect(params.country_code).toBe("EG");
    expect(params.include_inactive).toBe(false);
  });

  it("omits an empty country_code (no filter)", async () => {
    mock.onGet("/partners").reply(200, EMPTY_PAGE);

    await listPartners(false, "");

    const params = mock.history.get[0]?.params as Record<string, unknown>;
    expect("country_code" in params).toBe(false);
  });
});
