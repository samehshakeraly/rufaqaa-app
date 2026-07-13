import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import {
  type CommunityFollowupReport,
  getCommunityFollowupReport,
} from "@/lib/communityFollowup";

const EMPTY_REPORT: CommunityFollowupReport = {
  total: 0,
  governorates: [],
  reporting: { cadence_days: 90, grace_days: 7, on_track: 0, due_soon: 0, overdue: 0 },
  lives_with: [],
  health: [],
  sponsorship: { sponsored: 0, unsponsored: 0, sponsored_pct: null },
  files: { avg_completion: null, incomplete_count: 0 },
};

describe("getCommunityFollowupReport", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("GETs /orphans/community-report and returns the report body", async () => {
    mock.onGet("/orphans/community-report").reply(200, EMPTY_REPORT);

    const report = await getCommunityFollowupReport();

    expect(mock.history.get).toHaveLength(1);
    expect(report).toEqual(EMPTY_REPORT);
  });
});
