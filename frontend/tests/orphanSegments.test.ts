import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import { getOrphanSegments } from "@/lib/orphans";
import {
  EMPTY_ORPHAN_SLICE,
  orphanSliceFromSearchParams,
  orphanSliceParams,
  orphanSliceToSearchParams,
} from "@/lib/orphanSlice";

const EMPTY_SEGMENTS = { dimension: "case_status", total: 0, buckets: [] };

describe("getOrphanSegments query serialization", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("sends by plus the same filter params as listOrphans (repeated tags)", async () => {
    mock.onGet("/orphans/segments").reply(200, EMPTY_SEGMENTS);

    await getOrphanSegments({
      by: "education_stage",
      case_status: "available",
      is_hafiz: false,
      min_juz: 5,
      tags: ["a", "b"],
      tags_mode: "any",
      q: undefined,
    });

    const params = mock.history.get[0]?.params as URLSearchParams;
    expect(params.get("by")).toBe("education_stage");
    expect(params.get("case_status")).toBe("available");
    expect(params.get("is_hafiz")).toBe("false");
    expect(params.get("min_juz")).toBe("5");
    // Repeated entries (?tags=a&tags=b) — never the bracketed tags[] form.
    expect(params.getAll("tags")).toEqual(["a", "b"]);
    expect(params.get("tags_mode")).toBe("any");
    // undefined params are dropped entirely.
    expect(params.has("q")).toBe(false);
  });

  it("returns the report body as-is", async () => {
    const body = {
      dimension: "governorate",
      total: 4,
      buckets: [
        { key: "القاهرة", label: "القاهرة", count: 3 },
        { key: "other", label: null, count: 1 },
      ],
    };
    mock.onGet("/orphans/segments").reply(200, body);
    await expect(getOrphanSegments({ by: "governorate" })).resolves.toEqual(body);
  });
});

describe("orphan slice URL round-trip (report ⇄ orphan list deep-links)", () => {
  it("serializes only the set dimensions and hydrates back losslessly", () => {
    const slice = {
      ...EMPTY_ORPHAN_SLICE,
      educationStage: "primary" as const,
      isHafiz: "false" as const,
      minJuz: "5",
      tags: ["a", "b"],
      tagsMode: "any" as const,
      priority: "high" as const,
    };
    const sp = orphanSliceToSearchParams(slice);
    expect(sp.getAll("tags")).toEqual(["a", "b"]);
    expect(sp.get("education_stage")).toBe("primary");
    expect(sp.has("health_status")).toBe(false);
    expect(sp.has("orphan_type")).toBe(false);
    expect(orphanSliceFromSearchParams(sp)).toEqual(slice);
  });

  it("ignores malformed or out-of-vocabulary URL values", () => {
    const sp = new URLSearchParams(
      "education_stage=hacker&is_hafiz=maybe&min_juz=abc&priority=high&tags_mode=any",
    );
    const slice = orphanSliceFromSearchParams(sp);
    expect(slice.educationStage).toBe("");
    expect(slice.isHafiz).toBe("");
    expect(slice.minJuz).toBe("");
    expect(slice.priority).toBe("high");
    // tags_mode without tags is harmless — it only ships alongside tags.
    expect(slice.tagsMode).toBe("any");
  });

  it("maps the slice to the exact API params the orphan list sends", () => {
    expect(orphanSliceParams(EMPTY_ORPHAN_SLICE)).toEqual({});
    expect(
      orphanSliceParams({
        ...EMPTY_ORPHAN_SLICE,
        isHafiz: "true",
        minJuz: "12",
        tags: ["x"],
        tagsMode: "all",
        minCompletion: "40",
      }),
    ).toEqual({
      is_hafiz: true,
      min_juz: 12,
      tags: ["x"],
      tags_mode: "all",
      min_completion: 40,
    });
  });
});
