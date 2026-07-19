import { describe, expect, it } from "vitest";
import { scanTmp } from "./helpers";
import { isTestFile, isTestOnly, effectiveSeverity } from "../src/findings";
import { isActionable } from "../src/status";
import { renderReport } from "../src/report";
import { Finding, ScanResult } from "../src/types";

const MODEL = '"claude-sonnet-4-20250514"';
const ID = "anthropic-claude-4-retirement";
const NOW = new Date("2026-06-07T00:00:00Z");

function findById(r: ScanResult, id: string): Finding {
  const f = r.findings.find((x) => x.deprecation.id === id);
  if (!f) throw new Error(`expected a finding for ${id}`);
  return f;
}

describe("isTestFile", () => {
  it("flags test directories and file-name conventions", () => {
    for (const p of [
      "tests/a.ts",
      "src/test/a.ts",
      "src/__tests__/a.tsx",
      "spec/a.js",
      "pkg/test_foo.py",
      "pkg/foo_test.py",
      "conftest.py",
      "a.test.ts",
      "a.test.tsx",
      "b.spec.js",
      "c.spec.mts",
    ]) {
      expect(isTestFile(p), p).toBe(true);
    }
  });

  it("does not flag ordinary source files with similar names", () => {
    for (const p of [
      "src/app.ts",
      "src/latest.ts",
      "lib/contest.py",
      "src/attestation.ts",
      "components/Tester.tsx",
      "src/testing/util.ts",
    ]) {
      expect(isTestFile(p), p).toBe(false);
    }
  });
});

describe("test-file matches are down-ranked", () => {
  it("a test-only HIGH finding reports as effective LOW (entry severity unchanged)", () => {
    const f = findById(scanTmp({ "src/foo.test.ts": `const m = ${MODEL};\n` }), ID);
    expect(isTestOnly(f)).toBe(true);
    expect(effectiveSeverity(f)).toBe("low");
    expect(f.deprecation.severity).toBe("high");
  });

  it("production usage keeps HIGH", () => {
    // Real usage = the SDK is imported (otherwise it's a mention-tier match,
    // covered in mention.test.ts).
    const f = findById(
      scanTmp({
        "src/app.ts": `import Anthropic from "@anthropic-ai/sdk";\nconst m = ${MODEL};\n`,
      }),
      ID
    );
    expect(isTestOnly(f)).toBe(false);
    expect(effectiveSeverity(f)).toBe("high");
  });

  it("mixed test + production evidence stays HIGH", () => {
    const f = findById(
      scanTmp({
        "src/app.ts": `import Anthropic from "@anthropic-ai/sdk";\nconst m = ${MODEL};\n`,
        "src/app.test.ts": `const m = ${MODEL};\n`,
      }),
      ID
    );
    expect(isTestOnly(f)).toBe(false);
    expect(effectiveSeverity(f)).toBe("high");
  });

  it("a test-only finding does not trip the CI gate (mirrors cli's gate)", () => {
    const f = findById(scanTmp({ "tests/a.ts": `const m = ${MODEL};\n` }), ID);
    // Entry is HIGH, so isActionable() alone would be true; the gate excludes test-only.
    expect(isActionable(f.deprecation, NOW, 30)).toBe(true);
    expect(!isTestOnly(f) && isActionable(f.deprecation, NOW, 30)).toBe(false);
  });

  it("the report shows the down-ranked pill for test-only matches", () => {
    const out = renderReport(scanTmp({ "src/foo.test.ts": `const m = ${MODEL};\n` }), {
      color: false,
      now: NOW,
    });
    expect(out).toMatch(/Claude Sonnet 4 & Opus 4 \[LOW\]/);
    expect(out).not.toMatch(/Claude Sonnet 4 & Opus 4 \[HIGH\]/);
  });
});
