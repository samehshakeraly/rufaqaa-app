import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import { listOrphans } from "@/lib/orphans";

const EMPTY_PAGE = { items: [], total: 0, limit: 20, offset: 0 };

describe("listOrphans query serialization", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("repeats tags, stringifies scalars, and omits undefined", async () => {
    mock.onGet("/orphans").reply(200, EMPTY_PAGE);

    await listOrphans({
      limit: 20,
      offset: 0,
      is_hafiz: true,
      min_juz: 5,
      education_stage: "primary",
      tags: ["top_student", "needs_glasses"],
      tags_mode: "any",
      q: undefined,
    });

    const params = mock.history.get[0]?.params as URLSearchParams;
    // Repeated entries (?tags=a&tags=b) — never the bracketed tags[] form.
    expect(params.getAll("tags")).toEqual(["top_student", "needs_glasses"]);
    expect(params.toString()).toContain("tags=top_student&tags=needs_glasses");
    expect(params.toString()).not.toContain("tags%5B%5D");
    // Booleans/numbers go out as plain strings.
    expect(params.get("is_hafiz")).toBe("true");
    expect(params.get("min_juz")).toBe("5");
    expect(params.get("education_stage")).toBe("primary");
    expect(params.get("tags_mode")).toBe("any");
    // Undefined keys are dropped, not sent as "undefined".
    expect(params.has("q")).toBe(false);
  });

  it("sends an empty query when called with no params", async () => {
    mock.onGet("/orphans").reply(200, EMPTY_PAGE);

    await listOrphans();

    const params = mock.history.get[0]?.params as URLSearchParams | undefined;
    expect(params?.toString() ?? "").toBe("");
  });
});
