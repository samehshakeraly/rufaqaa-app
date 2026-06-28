import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import { getInHerWords, setInHerWords } from "@/lib/inHerWords";

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

describe("inHerWords API client", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it("GET returns the full ordered list (incl. ids)", async () => {
    const list = {
      items: [
        { id: "p1", text: "أحبّ القراءة", said_on: "2026-02-10" },
        { id: "p2", text: "أريد أن أصبح طبيبة", said_on: null },
      ],
    };
    mock.onGet(`/orphans/${ORPHAN_ID}/in-her-words`).reply(200, list);

    const got = await getInHerWords(ORPHAN_ID);

    expect(got).toEqual(list);
  });

  it("PUT sends the raw array body and returns the canonical list", async () => {
    const body = [
      { id: "p1", text: "عبارة", said_on: null },
      { text: "عبارة جديدة", said_on: "2026-01-01" },
    ];
    const canonical = {
      items: [
        { id: "p1", text: "عبارة", said_on: null },
        { id: "new", text: "عبارة جديدة", said_on: "2026-01-01" },
      ],
    };
    mock.onPut(`/orphans/${ORPHAN_ID}/in-her-words`).reply(200, canonical);

    const got = await setInHerWords(ORPHAN_ID, body);

    // The body is the bare array (not wrapped in an object).
    expect(JSON.parse(mock.history.put[0]!.data)).toEqual(body);
    expect(got).toEqual(canonical);
  });
});
