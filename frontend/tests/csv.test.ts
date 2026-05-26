import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses a basic CSV with a header", () => {
    const rows = parseCsv("name,email\nAhmed,a@x.com\nFatima,f@x.com\n");
    expect(rows).toEqual([
      ["name", "email"],
      ["Ahmed", "a@x.com"],
      ["Fatima", "f@x.com"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('name,note\n"Smith, J.","said ""hi"""\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["Smith, J.", 'said "hi"'],
    ]);
  });

  it("handles CRLF line endings and a BOM", () => {
    const rows = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves newlines inside quoted fields", () => {
    const rows = parseCsv('a,b\n"line1\nline2",x\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("ignores trailing empty lines but keeps the final row without a newline", () => {
    const rows = parseCsv("a,b\n1,2");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
