import * as fs from "fs";
import { describe, expect, it } from "vitest";
import { DATASET_PATH } from "./helpers";
import { modelRegexSource } from "../src/scanner";
import { parseSunsetDate } from "../src/status";

interface RawEntry {
  id?: unknown;
  vendor?: unknown;
  title?: unknown;
  severity?: unknown;
  match?: unknown;
  migration_url?: unknown;
  source?: unknown;
  confidence?: unknown;
  applies_to?: unknown;
  sunset_date?: unknown;
  announced_date?: unknown;
  detect?: { patterns?: unknown; models?: unknown };
}

const raw: RawEntry[] = JSON.parse(fs.readFileSync(DATASET_PATH, "utf8"));

const SEVERITIES = new Set(["high", "medium", "low"]);
const MATCH_MODES = new Set(["pattern", "sdk", "version"]);
const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

describe("dataset integrity (deprecations.json)", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBeGreaterThan(0);
  });

  it("every entry has the required string fields + a non-empty source", () => {
    for (const e of raw) {
      const where = `entry ${JSON.stringify(e.id)}`;
      expect(isNonEmptyString(e.id), `${where}: id`).toBe(true);
      expect(isNonEmptyString(e.vendor), `${where}: vendor`).toBe(true);
      expect(isNonEmptyString(e.title), `${where}: title`).toBe(true);
      expect(isNonEmptyString(e.severity), `${where}: severity`).toBe(true);
      expect(isNonEmptyString(e.match), `${where}: match`).toBe(true);
      expect(isNonEmptyString(e.migration_url), `${where}: migration_url`).toBe(true);
      expect(isNonEmptyString(e.source), `${where}: source`).toBe(true);
    }
  });

  it("provenance is explicit: confidence required, announced_date parses", () => {
    const CONFIDENCES = new Set(["confirmed", "reported", "inferred"]);
    for (const e of raw) {
      const where = `entry ${JSON.stringify(e.id)}`;
      // Every bundled entry must state how well-evidenced it is — agent-drafted
      // entries (Stage B) inherit this requirement.
      expect(
        CONFIDENCES.has(e.confidence as string),
        `${where}: confidence must be confirmed|reported|inferred`
      ).toBe(true);
      if (e.announced_date != null) {
        expect(
          parseSunsetDate(e.announced_date as string) !== null,
          `${where}: announced_date ${JSON.stringify(e.announced_date)} parses`
        ).toBe(true);
      }
    }
  });

  it("has no duplicate ids", () => {
    const ids = raw.map((e) => e.id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every pattern and model regex compiles", () => {
    for (const e of raw) {
      for (const p of e.detect?.patterns ?? ([] as unknown[])) {
        expect(() => new RegExp(p as string, "g"), `pattern ${p}`).not.toThrow();
      }
      for (const m of e.detect?.models ?? ([] as unknown[])) {
        expect(
          () => new RegExp(modelRegexSource(m as string), "g"),
          `model ${m}`
        ).not.toThrow();
      }
    }
  });

  it("severity, match, applies_to, and sunset_date are all valid", () => {
    for (const e of raw) {
      const where = `entry ${JSON.stringify(e.id)}`;
      expect(SEVERITIES.has(e.severity as string), `${where}: severity`).toBe(true);
      expect(MATCH_MODES.has(e.match as string), `${where}: match`).toBe(true);

      if (e.applies_to !== undefined) {
        expect(Array.isArray(e.applies_to), `${where}: applies_to array`).toBe(true);
        for (const ext of e.applies_to as unknown[]) {
          expect(
            typeof ext === "string" && /^(\*|[a-z0-9]+)$/.test(ext),
            `${where}: applies_to value ${JSON.stringify(ext)}`
          ).toBe(true);
        }
      }

      // sunset_date must be null/absent, or a string that actually parses.
      if (e.sunset_date != null) {
        expect(
          parseSunsetDate(e.sunset_date as string) !== null,
          `${where}: sunset_date ${JSON.stringify(e.sunset_date)} parses`
        ).toBe(true);
      }
    }
  });

  it("loads cleanly through the validating loader (no entries dropped)", async () => {
    const { loadDeprecations } = await import("../src/data");
    expect(loadDeprecations().length).toBe(raw.length);
  });

  it("status⟺null-date invariant: effective status is 'deprecated' iff sunset_date is null", async () => {
    const { loadDeprecations } = await import("../src/data");
    const { effectiveStatus } = await import("../src/status");
    // Fixed clock: a non-null date never derives to "deprecated" regardless of
    // `now`, so this assertion is deterministic across run dates.
    const NOW = new Date("2026-06-06T00:00:00Z");
    for (const e of loadDeprecations()) {
      const dateless = e.sunset_date === null;
      const isDeprecated = effectiveStatus(e, NOW) === "deprecated";
      // Catches both failure modes: an explicit status:"deprecated" paired with a
      // real sunset_date, and a dated/null entry whose explicit status disagrees.
      expect(
        isDeprecated,
        `entry ${JSON.stringify(e.id)}: effectiveStatus "deprecated" must hold iff sunset_date === null`
      ).toBe(dateless);
    }
  });
});
