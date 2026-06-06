import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadDeprecations } from "../src/data";
import { scanRepo, ScanOptions } from "../src/scanner";
import { Deprecation, ScanResult, Severity, Status } from "../src/types";

export const REPO_ROOT = process.cwd();
export const DATASET_PATH = path.join(
  REPO_ROOT,
  "src",
  "data",
  "deprecations.json"
);

/**
 * Write a set of files into a fresh temp dir, scan it with the bundled dataset,
 * and return the result. Keys are repo-relative paths; values are file contents.
 */
export function scanTmp(
  files: Record<string, string>,
  opts: ScanOptions = {}
): ScanResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arol-test-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return scanRepo(dir, loadDeprecations(), opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** IDs of the deprecations that fired in a scan result. */
export function firedIds(result: ScanResult): string[] {
  return result.findings.map((f) => f.deprecation.id);
}

/** Did a specific deprecation id fire? */
export function fired(result: ScanResult, id: string): boolean {
  return result.findings.some((f) => f.deprecation.id === id);
}

/** Build a minimal Deprecation for unit-testing status/exit logic. */
export function mkDep(overrides: Partial<Deprecation> = {}): Deprecation {
  return {
    id: "test-dep",
    vendor: "Test",
    title: "Test deprecation",
    severity: (overrides.severity ?? "medium") as Severity,
    match: "pattern",
    sunset_date: null,
    applies_to: ["*"],
    detect: { sdk: [], patterns: ["x"], models: [] },
    migration_url: "https://example.com",
    summary: "test",
    ...overrides,
  };
}

export type { Status };
