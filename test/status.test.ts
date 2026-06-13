import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report";
import { daysUntil, effectiveStatus, isActionable } from "../src/status";
import { Deprecation, ScanResult } from "../src/types";
import { mkDep } from "./helpers";

const NOW = new Date("2026-06-06T00:00:00Z");

function renderOne(dep: Deprecation): string {
  const result: ScanResult = {
    scannedFiles: 1,
    manifestsScanned: [],
    findings: [
      {
        deprecation: dep,
        manifestMatches: [],
        patternMatches: [{ file: "a.ts", line: 1, text: "x" }],
      },
    ],
  };
  return renderReport(result, { color: false, now: NOW });
}

/** YYYY-MM-DD `days` after NOW (UTC). */
function isoFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("status derivation", () => {
  it("derives deprecated/retired/scheduled from the date", () => {
    expect(effectiveStatus(mkDep({ sunset_date: null }), NOW)).toBe("deprecated");
    expect(effectiveStatus(mkDep({ sunset_date: "2020-01-01" }), NOW)).toBe("retired");
    expect(effectiveStatus(mkDep({ sunset_date: "2030-01-01" }), NOW)).toBe("scheduled");
  });

  it("honors an explicit status over the date", () => {
    const d = mkDep({ status: "deprecated", sunset_date: "2020-01-01" });
    expect(effectiveStatus(d, NOW)).toBe("deprecated");
  });

  it("daysUntil never returns NaN for a null date", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("2026-06-20", NOW)).toBe(14);
  });
});

describe("status rendering", () => {
  it("dateless deprecated renders the no-date message, never NaN", () => {
    const out = renderOne(mkDep({ status: "deprecated", sunset_date: null }));
    expect(out).toContain("deprecated · no removal date announced");
    expect(out).not.toContain("NaN");
  });

  it("past date renders retired wording", () => {
    const out = renderOne(mkDep({ severity: "high", sunset_date: "2020-01-01" }));
    expect(out).toContain("retired 2020-01-01");
    expect(out).toMatch(/days ago/);
    expect(out).not.toContain("NaN");
  });

  it("future date renders a countdown", () => {
    const out = renderOne(mkDep({ severity: "high", sunset_date: "2030-01-01" }));
    expect(out).toContain("sunsets 2030-01-01");
    expect(out).toMatch(/in \d+ days/);
    expect(out).not.toContain("NaN");
  });
});

describe("zero scannable files", () => {
  it("warns instead of giving the green all-clear", () => {
    const result: ScanResult = {
      scannedFiles: 0,
      manifestsScanned: [],
      findings: [],
    };
    const out = renderReport(result, {
      color: false,
      now: NOW,
      path: "/tmp/empty-dir",
    });

    // The no-scannable-files warning is shown...
    expect(out).toContain("⚠");
    expect(out).toContain("No scannable files found");
    expect(out).toContain("/tmp/empty-dir");
    expect(out).toContain(".ts"); // lists the extensions arol scans
    // ...and the clean-scan success message is NOT.
    expect(out).not.toContain("No upcoming deprecations detected");
    expect(out).not.toContain("✓");
  });
});

describe("exit gate (isActionable)", () => {
  it("any high-severity finding is actionable (exit non-zero)", () => {
    expect(isActionable(mkDep({ severity: "high", sunset_date: null }), NOW, 30)).toBe(true);
    expect(isActionable(mkDep({ severity: "high", sunset_date: "2020-01-01" }), NOW, 30)).toBe(true);
  });

  it("medium dateless / retired findings are warn-only (exit 0)", () => {
    expect(isActionable(mkDep({ severity: "medium", sunset_date: null }), NOW, 30)).toBe(false);
    expect(isActionable(mkDep({ severity: "medium", sunset_date: "2020-01-01" }), NOW, 30)).toBe(false);
  });

  it("a medium scheduled finding is actionable only within the window", () => {
    const soon = mkDep({ severity: "medium", sunset_date: isoFromNow(14) });
    expect(isActionable(soon, NOW, 30)).toBe(true);
    expect(isActionable(soon, NOW, 7)).toBe(false);

    const later = mkDep({ severity: "medium", sunset_date: isoFromNow(120) });
    expect(isActionable(later, NOW, 30)).toBe(false);
  });
});
