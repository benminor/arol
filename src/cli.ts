#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { DatasetSource, LoadedDataset, loadForScan } from "./data";
import { scanRepo } from "./scanner";
import { renderReport } from "./report";
import { Severity } from "./types";
import { effectiveStatus, isActionable } from "./status";
import { effectiveSeverity, isMentionOnly, isTestOnly } from "./findings";
import { AutoUpdateResult, isOffline, maybeAutoUpdate, performUpdate } from "./update";
import { submitReport } from "./report-upload";
import {
  findRepoRoot,
  ghAvailable,
  ghSetSecret,
  githubRemoteRepo,
  readRepoToken,
  REPO_TOKEN_PATH,
  runInit,
  saveRepoToken,
  secretsUrl,
  shouldSuggestInit,
  WORKFLOW_PATH,
} from "./init";
import { makeStyler, Styler } from "./report";

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
        mentionOnly: isMentionOnly(f),
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
      initHint: shouldSuggestInit(root),
    });
    process.stdout.write(report + "\n");
  }

  // Opt-in monitoring report. Fail-soft by design: an upload problem warns on
  // stderr and never changes what the scan prints or how it exits.
  // --offline wins over a present token: "no network at all" means exactly that.
  // Resolution order: explicit flag > env var > this repo's saved token
  // (written by `arol-ai init` into .git/arol-token — repo-scoped on purpose).
  const flagOrEnvToken = opts.report ?? process.env.AROL_REPORT_TOKEN;
  const repoToken = flagOrEnvToken ? null : readRepoToken(root);
  const reportToken = flagOrEnvToken || repoToken || undefined;
  if (reportToken && offline) {
    process.stderr.write(
      "arol: report skipped (--offline) — no network use in offline mode\n"
    );
  } else if (reportToken) {
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
        ? `arol: report sent (${reportName})${repoToken ? " · using this repo's saved token" : ""}\n`
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
  // Weak-evidence findings (test-only, mention-only) never fail the build.
  const tripped = result.findings.some(
    (f) =>
      !isTestOnly(f) &&
      !isMentionOnly(f) &&
      isActionable(f.deprecation, now, within, { failOnRetired })
  );
  if (tripped) process.exitCode = 1;
}

const TOKENS_URL = "https://arol.ai/dashboard/tokens";

async function promptForToken(s: Styler): Promise<string> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      `${s.bold("paste token")} ${s.dim("(Enter to skip)")}: `
    );
    return answer.trim();
  } finally {
    rl.close();
  }
}

/**
 * The monitoring leg of `init`: point at the token page, take a pasted (or
 * --token supplied) token, and try to finish the job entirely in-terminal by
 * setting the repo's Actions secret via the GitHub CLI. Fallback is the exact
 * settings URL for this repo. The token is never echoed back and never
 * written to disk — it goes to the GitHub secret or nowhere.
 */
async function finishMonitoringSetup(s: Styler, tokenFlag?: string): Promise<void> {
  process.stdout.write(
    `${s.bold("monitoring")} ${s.dim("(optional)")} — get emailed when ${s.bold("new")} deprecations land on this repo\n` +
      `  create a token at ${s.underline(s.cyan(TOKENS_URL))} ${s.dim("(sign-in creates your account)")}\n`
  );

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let token = tokenFlag?.trim() ?? "";
  if (!token && interactive) {
    process.stdout.write("\n");
    token = await promptForToken(s);
  }

  if (!token) {
    process.stdout.write(
      s.dim(
        "  skipped — re-run arol-ai init anytime, or add a repo secret named AROL_REPORT_TOKEN\n"
      )
    );
    return;
  }

  if (token.length < 12) {
    process.stdout.write(
      `${s.yellow("·")} that doesn't look like a token — nothing was configured\n` +
        s.dim(`  create one at ${TOKENS_URL}, then re-run arol-ai init\n`)
    );
    return;
  }

  // 1. Repo-scoped save: local scans in THIS repo report from now on. This is
  // the part that works everywhere, gh or not — and only ever for this repo.
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) {
    saveRepoToken(repoRoot, token);
    process.stdout.write(
      `${s.green(s.bold("✓"))} saved for this repo — local scans here now report to your dashboard\n` +
        s.dim(
          `  (${REPO_TOKEN_PATH} · inside .git, can never be committed · remove: rm ${REPO_TOKEN_PATH})\n`
        )
    );
  }

  // 2. CI secret, fully automatic when the GitHub CLI is around.
  if (ghAvailable() && ghSetSecret(token)) {
    process.stdout.write(
      `${s.green(s.bold("✓"))} repo secret ${s.bold("AROL_REPORT_TOKEN")} set via gh — CI scans report too\n`
    );
    return;
  }

  const remote = repoRoot ? githubRemoteRepo(repoRoot) : null;
  process.stdout.write(
    `${s.yellow("→")} for CI too: add it as a repo secret named ${s.bold("AROL_REPORT_TOKEN")}\n` +
      (remote
        ? `  ${s.underline(s.cyan(secretsUrl(remote)))}\n`
        : s.dim("  GitHub → your repo → Settings → Secrets and variables → Actions\n"))
  );
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
    .command("init")
    .description(
      "add the arol scan to this repo's CI — writes .github/workflows/arol.yml\n" +
        "(scans every PR, pushes to main/master, and weekly — deprecations land\n" +
        "even when nobody pushes), then walks you through monitoring setup"
    )
    .option("--force", "overwrite an existing .github/workflows/arol.yml")
    .option(
      "--token <token>",
      "monitoring token to configure non-interactively (skips the prompt)"
    )
    .option("--no-color", "disable colored output")
    .action(async (options: { force?: boolean; token?: string; color: boolean }) => {
      const s = makeStyler(shouldUseColor(options.color));
      const outcome = runInit(process.cwd(), { force: options.force });

      if (outcome.kind === "not-git") {
        process.stderr.write(
          "arol: not a git repository — run init from inside your repo.\n" +
            "Recipes for any CI system: https://github.com/benminor/arol/blob/main/docs/ci.md\n"
        );
        process.exitCode = 2;
        return;
      }

      if (outcome.kind === "non-github") {
        process.stderr.write(
          `arol: this repo's remote is ${outcome.host}, not GitHub — no workflow written.\n` +
            "The scan itself runs in any CI (GitLab, CircleCI, Jenkins — it's one line):\n" +
            "https://github.com/benminor/arol/blob/main/docs/ci.md\n"
        );
        process.exitCode = 2;
        return;
      }

      if (outcome.kind === "already") {
        // The workflow being present isn't a dead end — monitoring setup is
        // the remaining value, and "I skipped the token, now I want it" is
        // exactly a re-run of init.
        process.stdout.write(
          outcome.ours
            ? `${s.yellow("·")} ${outcome.file} already exists — use ${s.bold("--force")} to regenerate\n\n`
            : `${s.yellow("·")} ${outcome.file} already runs arol\n\n`
        );
        await finishMonitoringSetup(s, options.token);
        return;
      }

      process.stdout.write(
        `${s.green(s.bold("✓"))} wrote ${s.cyan(WORKFLOW_PATH)}\n` +
          s.dim(
            "  scans every pull request and push to main/master, plus a weekly\n" +
              "  scheduled run — sunsets land even when nobody pushes\n"
          ) +
          "\n"
      );

      await finishMonitoringSetup(s, options.token);

      process.stdout.write(
        `\n${s.bold("done")} — commit the workflow and push` +
          s.dim(" · see it live now: ") +
          s.cyan("npx arol-ai scan") +
          "\n"
      );
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
