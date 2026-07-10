#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { loadDeprecations } from "./data";
import { scanRepo } from "./scanner";
import { renderReport } from "./report";
import { Severity } from "./types";
import { effectiveStatus, isActionable } from "./status";
import { effectiveSeverity, isTestOnly } from "./findings";

/** Read this package's version without importing across the rootDir boundary. */
function readVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function shouldUseColor(colorFlag: boolean): boolean {
  // commander sets colorFlag=false when --no-color is passed.
  if (!colorFlag) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

/** Default window (days) within which a scheduled finding fails the CI gate. */
const DEFAULT_WITHIN_DAYS = 30;

interface ScanCliOptions {
  json?: boolean;
  color: boolean;
  data?: string;
  within?: string;
  ignore?: string[];
  includeDeps?: boolean;
  failOnRetired?: boolean;
}

/** Commander collector so --ignore can be passed multiple times. */
function collectIgnore(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function runScan(targetPath: string | undefined, opts: ScanCliOptions): void {
  const root = path.resolve(targetPath ?? ".");

  // Validate the target directory up front for a friendly error.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    process.stderr.write(`arol: path not found: ${root}\n`);
    process.exitCode = 2;
    return;
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`arol: not a directory: ${root}\n`);
    process.exitCode = 2;
    return;
  }

  let deprecations;
  try {
    deprecations = loadDeprecations(opts.data);
  } catch (err) {
    process.stderr.write(`arol: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  const result = scanRepo(root, deprecations, {
    ignore: opts.ignore,
    dataPath: opts.data,
    includeDeps: opts.includeDeps,
  });

  // One clock for the whole run, so rendering and the exit gate agree.
  const now = new Date();

  if (opts.json) {
    const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const f of result.findings) counts[effectiveSeverity(f)]++;
    const payload = {
      scannedFiles: result.scannedFiles,
      manifestsScanned: result.manifestsScanned,
      detected: result.findings.length,
      counts,
      findings: result.findings.map((f) => ({
        id: f.deprecation.id,
        vendor: f.deprecation.vendor,
        title: f.deprecation.title,
        // Effective severity (down-ranked to "low" when all evidence is in
        // test files); baseSeverity is the entry's declared level.
        severity: effectiveSeverity(f),
        baseSeverity: f.deprecation.severity,
        testOnly: isTestOnly(f),
        match: f.deprecation.match,
        status: effectiveStatus(f.deprecation, now),
        sunset_date: f.deprecation.sunset_date,
        migration_url: f.deprecation.migration_url,
        summary: f.deprecation.summary,
        manifestMatches: f.manifestMatches,
        patternMatches: f.patternMatches,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    const report = renderReport(result, {
      color: shouldUseColor(opts.color),
      now,
      path: root,
    });
    process.stdout.write(report + "\n");
  }

  // A scan that walked zero source files is a misconfiguration, not a clean
  // pass. Exit with a distinct non-zero code (vs. 1 for real findings) so CI
  // fails loudly on a mis-pointed or empty target instead of going green.
  if (result.scannedFiles === 0 && result.findings.length === 0) {
    process.exitCode = 2;
    return;
  }

  // CI gate: exit non-zero only for an actionable finding — high (non-retired),
  // or scheduled within `--within` days (default 30). Retired high is warn-only
  // unless `--fail-on-retired`. Dateless medium/low stay warn-only.
  const parsedWithin = opts.within !== undefined ? parseInt(opts.within, 10) : NaN;
  const within =
    Number.isFinite(parsedWithin) && parsedWithin >= 0
      ? parsedWithin
      : DEFAULT_WITHIN_DAYS;
  const failOnRetired = opts.failOnRetired === true;
  // Test-only findings are down-ranked and never fail the build.
  const tripped = result.findings.some(
    (f) =>
      !isTestOnly(f) &&
      isActionable(f.deprecation, now, within, { failOnRetired })
  );
  if (tripped) process.exitCode = 1;
}

function main(argv: string[]): void {
  const program = new Command();

  program
    .name("arol-ai")
    .description(
      "Scan a local repo for upcoming third-party API/SDK deprecations.\n" +
        "Everything runs locally — no network, no telemetry, your code never leaves the machine."
    )
    .version(readVersion(), "-v, --version", "print the arol-ai version");

  program
    .command("scan", { isDefault: true })
    .argument("[path]", "directory to scan", ".")
    .description("scan a repository and print a deprecation report")
    .option("--json", "output machine-readable JSON instead of the report")
    .option("--no-color", "disable colored output")
    .option(
      "--data <file>",
      "use a custom deprecations.json dataset instead of the bundled one"
    )
    .option(
      "--ignore <glob>",
      "skip files matching this glob (repeatable); also reads .arolignore",
      collectIgnore,
      []
    )
    .option(
      "--include-deps",
      "also scan dependency/build dirs (node_modules, .venv, dist, …) normally skipped"
    )
    .option(
      "--within <days>",
      "fail (exit 1) on scheduled sunsets landing within this many days (default 30); high non-retired findings always fail"
    )
    .option(
      "--fail-on-retired",
      "also fail (exit 1) on high-severity findings whose sunset date is already past"
    )
    .action((pathArg: string | undefined, options: ScanCliOptions) => {
      runScan(pathArg, options);
    });

  program.parse(argv);
}

main(process.argv);
