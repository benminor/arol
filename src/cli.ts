#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { loadDeprecations } from "./data";
import { scanRepo } from "./scanner";
import { renderReport } from "./report";
import { Severity } from "./types";

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

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

interface ScanCliOptions {
  json?: boolean;
  color: boolean;
  data?: string;
  failOn?: string;
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

  const result = scanRepo(root, deprecations);

  if (opts.json) {
    const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const f of result.findings) counts[f.deprecation.severity]++;
    const payload = {
      scannedFiles: result.scannedFiles,
      manifestsScanned: result.manifestsScanned,
      detected: result.findings.length,
      counts,
      findings: result.findings.map((f) => ({
        id: f.deprecation.id,
        vendor: f.deprecation.vendor,
        title: f.deprecation.title,
        severity: f.deprecation.severity,
        match: f.deprecation.match,
        sunset_date: f.deprecation.sunset_date,
        migration_url: f.deprecation.migration_url,
        summary: f.deprecation.summary,
        manifestMatches: f.manifestMatches,
        patternMatches: f.patternMatches,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    const report = renderReport(result, { color: shouldUseColor(opts.color) });
    process.stdout.write(report + "\n");
  }

  // Optional CI gate: exit non-zero if a finding meets/exceeds the threshold.
  const failOn = opts.failOn?.toLowerCase();
  if (failOn && failOn !== "none") {
    const threshold =
      failOn === "any"
        ? 1
        : SEVERITY_RANK[failOn as Severity] ?? Number.POSITIVE_INFINITY;
    const tripped = result.findings.some(
      (f) => SEVERITY_RANK[f.deprecation.severity] >= threshold
    );
    if (tripped) process.exitCode = 1;
  }
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
      "--fail-on <severity>",
      "exit non-zero if findings meet this level: high | medium | low | any | none",
      "none"
    )
    .action((pathArg: string | undefined, options: ScanCliOptions) => {
      runScan(pathArg, options);
    });

  program.parse(argv);
}

main(process.argv);
