import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import {
  activatePlatformOrganization,
  createPlatformOrganization,
  fetchPlatformSettings,
  getPlatformOrganization,
  listPlatformOrganizations,
  suspendPlatformOrganization,
  updatePlatformOrganization,
  updatePlatformSettings,
} from "@/lib/platform";
import {
  fetchPlatformByOrg,
  fetchPlatformSummary,
  fetchPlatformTimeseries,
} from "@/lib/stats";

describe("platform client", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("lists organizations and forwards only the set filters", async () => {
    mock.onGet("/platform/organizations").reply((config) => {
      expect(config.params).toEqual({ status: "active", search: "abc" });
      return [200, [{ id: "o1", code: "ORG", name_ar: "أ", name_en: "A" }]];
    });

    const rows = await listPlatformOrganizations({ status: "active", search: "abc" });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("ORG");
  });

  it("lists organizations with no filters", async () => {
    mock.onGet("/platform/organizations").reply((config) => {
      expect(config.params).toEqual({});
      return [200, []];
    });
    expect(await listPlatformOrganizations()).toEqual([]);
  });

  it("gets a single organization by id", async () => {
    mock.onGet("/platform/organizations/o1").reply(200, { id: "o1", code: "ORG" });
    const org = await getPlatformOrganization("o1");
    expect(org.id).toBe("o1");
  });

  it("creates an organization and returns the provisioned admin", async () => {
    mock.onPost("/platform/organizations").reply((config) => {
      const body = JSON.parse(config.data);
      expect(body.code).toBe("NEW");
      expect(body.admin_email).toBe("admin@x.org");
      return [
        201,
        {
          organization: { id: "o2", code: "NEW" },
          admin_user: { id: "u1", email: "admin@x.org" },
        },
      ];
    });

    const res = await createPlatformOrganization({
      code: "NEW",
      name_ar: "ج",
      name_en: "New",
      country_code: "KW",
      default_currency: "KWD",
      org_type: "standalone",
      deployment_mode: "self_hosted",
      admin_email: "admin@x.org",
      admin_password: "password1",
      admin_first_name: "Org",
      admin_last_name: "Admin",
    });
    expect(res.admin_user.email).toBe("admin@x.org");
  });

  it("updates an organization", async () => {
    mock.onPatch("/platform/organizations/o1").reply((config) => {
      const body = JSON.parse(config.data);
      expect(body).toEqual({ status: "archived", subscription_plan: null });
      return [200, { id: "o1", status: "archived" }];
    });
    const org = await updatePlatformOrganization("o1", {
      status: "archived",
      subscription_plan: null,
    });
    expect(org.status).toBe("archived");
  });

  it("suspends an organization with a reason", async () => {
    mock.onPost("/platform/organizations/o1/suspend").reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ reason: "fraud" });
      return [200, { id: "o1", status: "suspended" }];
    });
    const org = await suspendPlatformOrganization("o1", "fraud");
    expect(org.status).toBe("suspended");
  });

  it("activates an organization", async () => {
    mock.onPost("/platform/organizations/o1/activate").reply(200, {
      id: "o1",
      status: "active",
    });
    const org = await activatePlatformOrganization("o1");
    expect(org.status).toBe("active");
  });

  it("reads and patches platform settings", async () => {
    mock.onGet("/platform/settings").reply(200, {
      settings: { maintenance_mode: false },
      updated_at: null,
      updated_by: null,
    });
    const read = await fetchPlatformSettings();
    expect(read.settings.maintenance_mode).toBe(false);

    mock.onPatch("/platform/settings").reply((config) => {
      expect(JSON.parse(config.data)).toEqual({
        settings: { maintenance_mode: true },
      });
      return [200, { settings: { maintenance_mode: true }, updated_at: null, updated_by: null }];
    });
    const patched = await updatePlatformSettings({ maintenance_mode: true });
    expect(patched.settings.maintenance_mode).toBe(true);
  });

  it("fetches platform stats (summary, timeseries, by-org)", async () => {
    mock.onGet("/stats/platform/summary").reply(200, {
      total_orgs: 3,
      active_orgs: 2,
      total_orphans: 10,
      total_donors: 5,
      total_sponsorships: 4,
      total_donated_converted: "100.00",
      total_donated_by_currency: [{ currency: "KWD", total: "100.00" }],
    });
    mock.onGet("/stats/platform/timeseries").reply(200, { months: [] });
    mock.onGet("/stats/platform/by-org").reply((config) => {
      expect(config.params).toEqual({ limit: 5 });
      return [200, { limit: 5, items: [] }];
    });

    expect((await fetchPlatformSummary()).total_orgs).toBe(3);
    expect((await fetchPlatformTimeseries()).months).toEqual([]);
    expect((await fetchPlatformByOrg(5)).limit).toBe(5);
  });
});
