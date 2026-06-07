import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { scanRepo } from "../src/scanner";
import { loadDeprecations } from "../src/data";
import { Deprecation, ScanResult } from "../src/types";

function scanWith(deps: Deprecation[], files: Record<string, string>): ScanResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arol-missing-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return scanRepo(dir, deps);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Each entry omits a normally-present field; the cast bypasses the loader's
// defaults so this exercises the scanner's own `?? []` guards directly.
const UNDERSPECIFIED = [
  { id: "omit-patterns", vendor: "T", title: "t", severity: "low", match: "pattern",
    sunset_date: null, applies_to: ["*"], migration_url: "", summary: "",
    detect: { models: ["zz-omit-patterns-model"] } },           // no sdk, no patterns
  { id: "omit-models", vendor: "T", title: "t", severity: "low", match: "pattern",
    sunset_date: null, applies_to: ["*"], migration_url: "", summary: "",
    detect: { patterns: ["zzOmitModelsToken"] } },              // no sdk, no models
  { id: "omit-applies-to", vendor: "T", title: "t", severity: "low", match: "pattern",
    sunset_date: null, migration_url: "", summary: "",
    detect: { patterns: ["zzOmitAppliesToken"] } },             // no applies_to
  { id: "omit-sdk", vendor: "T", title: "t", severity: "low", match: "sdk",
    sunset_date: null, applies_to: ["*"], migration_url: "", summary: "",
    detect: {} },                                                // sdk-mode, no detect.sdk
  { id: "have-sdk", vendor: "T", title: "t", severity: "low", match: "sdk",
    sunset_date: null, applies_to: ["*"], migration_url: "", summary: "",
    detect: { sdk: ["zz-have-pkg"] } },                          // control
] as unknown as Deprecation[];

describe("missing detect sub-arrays / applies_to never crash the scan", () => {
  it("scans without throwing and still produces the expected findings", () => {
    const files = {
      "src/a.ts":
        'const m = "zz-omit-patterns-model";\nzzOmitModelsToken();\nzzOmitAppliesToken();\n',
      "package.json": JSON.stringify({ dependencies: { "zz-have-pkg": "^1.0.0" } }),
    };

    let result: ScanResult | undefined;
    expect(() => {
      result = scanWith(UNDERSPECIFIED, files);
    }).not.toThrow();

    const ids = result!.findings.map((f) => f.deprecation.id).sort();
    // omit-applies-to fires too → missing applies_to still means "everywhere".
    expect(ids).toEqual([
      "have-sdk",
      "omit-applies-to",
      "omit-models",
      "omit-patterns",
    ]);
    // sdk-mode with no detect.sdk must be inert, not a crash.
    expect(ids).not.toContain("omit-sdk");
  });

  it("the real (loader-normalized) dataset still scans without throwing", () => {
    expect(() =>
      scanWith(loadDeprecations(), { "src/x.ts": "const ok = 1;\n" })
    ).not.toThrow();
  });
});
