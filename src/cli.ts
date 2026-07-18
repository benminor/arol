#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { DatasetSource, LoadedDataset, loadForScan } from "./data";
import { scanRepo } from "./scanner";
import { renderReport } from "./report";
import { Severity } from "./types";
import { effectiveStatus, isActionable } from "./status";
import { effectiveSeverity, isTestOnly } from "./findings";
import { AutoUpdateResult, isOffline, maybeAutoUpdate, performUpdate } from "./update";
import { submitReport } from "./report-upload";

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
  offline?: boolean;
  report?: string;
  reportName?: string;
  reportUrl?: string;
}

/** Commander collector so --ignore can be passed multiple times. */
function collectIgnore(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/** "updated today" / "updated 3 days ago" from an ISO timestamp. */
function describeAge(fetchedAt: string, now: Date): string {
  const ms = now.getTime() - Date.parse(fetchedAt);
  if (!Number.isFinite(ms) || ms < 0) return "updated recently";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return "updated today";
  return `updated ${days} day${days === 1 ? "" : "s"} ago`;
}

/** One dim line telling the user which dataset this scan used and how fresh. */
function describeDataset(
  source: DatasetSource,
  offline: boolean,
  auto: AutoUpdateResult | null,
  now: Date
): string {
  const suffix = offline ? " · offline" : "";
  if (source.origin === "custom") return `dataset: custom (${source.path})`;
  if (source.origin === "cache") {
    const age = source.fetchedAt ? describeAge(source.fetchedAt, now) : "updated (age unknown)";
    return `dataset: ${age}${suffix}`;
  }
  // Bundled: distinguish "user chose offline" from "refresh didn't work".
  if (offline) return `dataset: bundled${suffix}`;
  if (auto && auto.reason === "error") {
    return "dataset: bundled · refresh failed — check network or run arol-ai update";
  }
  return "dataset: bundled";
}

async function runScan(targetPath: string | undefined, opts: ScanCliOptions): Promise<void> {
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

  // Auto-refresh the dataset (fail-soft, ≤ once/day) unless the user opted out
  // or supplied their own file. Scan behavior never depends on the network:
  // any failure just means the cached/bundled dataset is used.
  const offline = opts.offline === true || isOffline(process.env);
  let auto: AutoUpdateResult | null = null;
  if (!opts.data && !offline) {
    auto = await maybeAutoUpdate();
  }

  let loaded: LoadedDataset;
  try {
    loaded = loadForScan(opts.data);
  } catch (err) {
    process.stderr.write(`arol: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  if (loaded.warning) {
    process.stderr.write(`arol: warning: ${loaded.warning}\n`);
  }
  const deprecations = loaded.deprecations;

  const result = scanRepo(root, deprecations, {
    ignore: opts.ignore,
    dataPath: opts.data,
    includeDeps: opts.includeDeps,
  });

  // One clock for the whole run, so rendering and the exit gate agree.
  const now = new Date();
  const datasetNote = describeDataset(loaded.source, offline, auto, now);

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of result.findings) counts[effectiveSeverity(f)]++;
  // One payload shape for --json output AND the opt-in --report upload — the
  // printed JSON is exactly what monitoring would receive. No hidden fields.
  const payload = {
      scannedFiles: result.scannedFiles,
      manifestsScanned: result.manifestsScanned,
      dataset: { origin: loaded.source.origin, fetchedAt: loaded.source.fetchedAt },
      inventory: { dependencies: result.dependencies },
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
        announced_date: f.deprecation.announced_date,
        source: f.deprecation.source,
        confidence: f.deprecation.confidence ?? null,
        migration_url: f.deprecation.migration_url,
        summary: f.deprecation.summary,
        manifestMatches: f.manifestMatches,
        patternMatches: f.patternMatches,
      })),
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    const report = renderReport(result, {
      color: shouldUseColor(opts.color),
      now,
      path: root,
      datasetNote,
    });
    process.stdout.write(report + "\n");
  }

  // Opt-in monitoring report. Fail-soft by design: an upload problem warns on
  // stderr and never changes what the scan prints or how it exits.
  const reportToken = opts.report ?? process.env.AROL_REPORT_TOKEN;
  if (reportToken) {
    const reportName = opts.reportName ?? path.basename(root);
    const sent = await submitReport(
      {
        repo: reportName,
        cliVersion: readVersion(),
        reportedAt: now.toISOString(),
        ...payload,
      },
      { token: reportToken, url: opts.reportUrl }
    );
    process.stderr.write(
      sent.ok
        ? `arol: report sent (${reportName})\n`
        : `arol: warning: report upload failed (${sent.detail}) — scan results unaffected\n`
    );
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

async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("arol-ai")
    .description(
      "Scan a local repo for upcoming third-party API/SDK deprecations.\n" +
        "Your code never leaves the machine — scanning is local and uploads nothing.\n" +
        "The deprecation dataset auto-refreshes (one public JSON file, ≤ once/day);\n" +
        "disable with --offline or AROL_OFFLINE=1."
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
    .option(
      "--offline",
      "skip the dataset auto-refresh; scan with the cached/bundled dataset only"
    )
    .option(
      "--report <token>",
      "opt-in: upload scan results + inventory for continuous monitoring (also: AROL_REPORT_TOKEN)"
    )
    .option(
      "--report-name <name>",
      "repo name attached to the report (default: scanned directory name)"
    )
    .option(
      "--report-url <url>",
      "alternate ingest endpoint for reports (self-hosted / testing)"
    )
    .action(async (pathArg: string | undefined, options: ScanCliOptions) => {
      await runScan(pathArg, options);
    });

  program
    .command("update")
    .description(
      "download the latest deprecations dataset to the local cache now (ignores the 24h auto-refresh window)"
    )
    .option("--url <url>", "alternate dataset URL")
    .action(async (options: { url?: string }) => {
      try {
        const result = await performUpdate({ url: options.url });
        process.stdout.write(
          `arol: dataset updated · ${result.entries} entries · ${result.path}\n`
        );
      } catch (err) {
        process.stderr.write(`arol: update failed: ${(err as Error).message}\n`);
        process.exitCode = 2;
      }
    });

  await program.parseAsync(argv);
}

main(process.argv).catch((err) => {
  process.stderr.write(`arol: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
