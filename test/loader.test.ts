import { describe, expect, it } from "vitest";
import { parseDeprecations } from "../src/data";

/**
 * Forward-compatibility of the loader. The dataset auto-updates independently
 * of the installed CLI, so an OLD binary will eventually read entries written
 * for a NEWER schema. Unknown match modes must be skipped — never coerced to
 * "pattern", which would run a future entry's signals under the wrong engine.
 */

const base = {
  id: "x",
  vendor: "V",
  title: "T",
  severity: "high",
  sunset_date: null,
  detect: { sdk: [], patterns: ["\\bfooToken\\b"], models: [] },
  migration_url: "",
  summary: "",
  source: "https://example.com/notice",
};

const load = (entries: unknown[]) =>
  parseDeprecations(JSON.stringify(entries), "test-dataset");

describe("loader forward-compatibility (match modes)", () => {
  it('defaults an omitted or null match to "pattern"', () => {
    expect(load([{ ...base }])[0].match).toBe("pattern");
    expect(load([{ ...base, match: null }])[0].match).toBe("pattern");
  });

  it("honors all known modes", () => {
    const sdkEntry = {
      ...base,
      match: "sdk",
      detect: { sdk: ["pkg"], patterns: [], models: [] },
    };
    expect(load([{ ...base, match: "pattern" }])[0].match).toBe("pattern");
    expect(load([sdkEntry])[0].match).toBe("sdk");
    expect(load([{ ...sdkEntry, match: "version" }])[0].match).toBe("version");
  });

  it("drops entries with an unknown match mode instead of misreading them", () => {
    // A hypothetical future mode this CLI version has never heard of.
    const future = { ...base, match: "endpoint" };
    expect(load([future])).toHaveLength(0);
    // Empty-string is malformed, not omitted — also dropped.
    expect(load([{ ...base, match: "" }])).toHaveLength(0);
  });

  it("a dropped future entry never takes its valid siblings down with it", () => {
    const list = load([{ ...base, match: "endpoint" }, { ...base, id: "y" }]);
    expect(list.map((e) => e.id)).toEqual(["y"]);
  });
});
