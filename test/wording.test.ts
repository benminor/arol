import { describe, expect, it } from "vitest";
import { loadDeprecations } from "../src/data";
import { scanTmp } from "./helpers";
import { renderReport } from "../src/report";

const NOW = new Date("2026-06-07T00:00:00Z");
const byId = Object.fromEntries(loadDeprecations().map((d) => [d.id, d]));

describe("migration targets (Change 2)", () => {
  it("Opus 4 retirement recommends Opus 4.8, not 4.6 — Sonnet stays 4.6", () => {
    const s = byId["anthropic-claude-4-retirement"].summary;
    expect(s).toContain("Opus 4.8");
    expect(s).not.toContain("Opus 4.6");
    expect(s).toContain("Sonnet 4.6");
  });

  it("retired-legacy Claude summary recommends Opus 4.8, not 4.6", () => {
    const s = byId["anthropic-retired-legacy-claude"].summary;
    expect(s).toContain("Opus 4.8");
    expect(s).not.toContain("Opus 4.6");
  });
});

describe("findings no longer assert a call will fail (Change 4)", () => {
  it("no dataset summary claims a call/request will or now fails", () => {
    for (const d of loadDeprecations()) {
      expect(d.summary, d.id).not.toMatch(/(will|now)\s+fail|requests[^.]*\bfail/i);
    }
  });

  it("the report frames a model reference as a reference, not a guaranteed failure", () => {
    const out = renderReport(
      scanTmp({ "src/app.ts": 'const m = "claude-sonnet-4-20250514";\n' }),
      { color: false, now: NOW }
    );
    expect(out).toContain("references a deprecated model");
    expect(out.toLowerCase()).not.toContain("will fail");
  });

  it("test references are softened in the report wording", () => {
    const out = renderReport(
      scanTmp({ "src/app.test.ts": 'const m = "claude-sonnet-4-20250514";\n' }),
      { color: false, now: NOW }
    );
    expect(out).toContain("test code references a deprecated model");
  });
});
