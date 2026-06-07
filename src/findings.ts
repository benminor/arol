import { Finding, Severity } from "./types";

/**
 * Test-file detection and the resulting severity down-rank.
 *
 * A deprecated reference inside test code is not production breakage, so its
 * finding is reported at a reduced severity and never trips the CI gate.
 */

/** Directory names that mark a test tree. */
const TEST_DIR_SEGMENTS = new Set(["tests", "test", "__tests__", "spec"]);

/**
 * Is this repo-relative path a test file? Detected by a test directory segment
 * (tests/test/__tests__/spec) or by file-name convention:
 *   test_*.py, *_test.py, conftest.py, *.test.{js,ts,jsx,tsx,…}, *.spec.{…}
 */
export function isTestFile(relPath: string): boolean {
  const segments = relPath.split(/[\\/]/);
  const base = segments.pop() ?? "";

  // Any parent directory named like a test tree.
  if (segments.some((seg) => TEST_DIR_SEGMENTS.has(seg))) return true;

  // Python conventions.
  if (base === "conftest.py") return true;
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true;

  // JS/TS conventions: *.test.* / *.spec.* (js, mjs, cjs, jsx, ts, mts, cts, tsx).
  if (/\.(test|spec)\.(c|m)?[jt]sx?$/.test(base)) return true;

  return false;
}

/**
 * A finding is "test-only" when all of its evidence is in test files: it has
 * pattern matches, every one is a test file, and there is no manifest evidence
 * (manifests like package.json are never test files). Such findings are
 * down-ranked and excluded from the CI gate.
 */
export function isTestOnly(finding: Finding): boolean {
  if (finding.manifestMatches.length > 0) return false;
  if (finding.patternMatches.length === 0) return false;
  return finding.patternMatches.every((m) => isTestFile(m.file));
}

/**
 * The severity to report/sort/gate by: the entry's severity, but capped to "low"
 * when the finding is test-only (a deprecated reference in tests is informational,
 * never HIGH).
 */
export function effectiveSeverity(finding: Finding): Severity {
  return isTestOnly(finding) ? "low" : finding.deprecation.severity;
}
