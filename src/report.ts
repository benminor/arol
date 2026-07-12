import { Deprecation, Finding, ScanResult, Severity } from "./types";
import { daysUntil, effectiveStatus } from "./status";
import { effectiveSeverity, isTestOnly } from "./findings";
import { SOURCE_EXTENSIONS } from "./scanner";

/** A set of string-styling functions. When disabled, every function is identity. */
type Styler = ReturnType<typeof makeStyler>;

function makeStyler(enabled: boolean) {
  const wrap =
    (open: number, close: number) =>
    (s: string): string =>
      enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;
  return {
    enabled,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    underline: wrap(4, 24),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    cyan: wrap(36, 39),
    gray: wrap(90, 39),
    white: wrap(97, 39),
    black: wrap(30, 39),
    bgRed: wrap(41, 49),
    bgYellow: wrap(43, 49),
    bgBlue: wrap(44, 49),
  };
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function severityColor(s: Styler, sev: Severity): (t: string) => string {
  if (sev === "high") return s.red;
  if (sev === "medium") return s.yellow;
  return s.blue;
}

/** A colored pill like ` HIGH `. */
function severityPill(s: Styler, sev: Severity): string {
  const label = ` ${sev.toUpperCase()} `;
  if (!s.enabled) return `[${sev.toUpperCase()}]`;
  if (sev === "high") return s.bgRed(s.white(s.bold(label)));
  if (sev === "medium") return s.bgYellow(s.black(s.bold(label)));
  return s.bgBlue(s.white(s.bold(label)));
}

function dayCount(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * Render the lifecycle line for a finding, keyed on its (effective) status.
 * Date math runs ONLY for dated statuses, so a null sunset_date never produces NaN.
 */
function statusPhrase(s: Styler, d: Deprecation, now: Date): string {
  const status = effectiveStatus(d, now);
  const days = daysUntil(d.sunset_date, now);

  // Dateless (or, defensively, a dated status with no parseable date).
  if (status === "deprecated" || days === null) {
    return s.yellow(
      "deprecated · no removal date announced — migrate before it's pulled"
    );
  }

  if (status === "retired") {
    const ago = Math.abs(days);
    return s.red(`retired ${d.sunset_date} (${dayCount(ago)} ago)`);
  }

  // scheduled
  const rel = days <= 0 ? "today" : `in ${dayCount(days)}`;
  const line = `sunsets ${d.sunset_date} (${rel})`;
  return days <= 30 ? s.red(line) : s.yellow(line);
}

/** One line per source location: "path:line  →  matched text". */
function formatPatternMatches(s: Styler, finding: Finding): string[] {
  // De-duplicate identical file:line:text triples and order by file then line.
  const seen = new Set<string>();
  const items = finding.patternMatches.filter((pm) => {
    const key = `${pm.file}:${pm.line}:${pm.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const MAX = 12;
  const shown = items.slice(0, MAX);
  const lines = shown.map(
    (pm) =>
      `${s.cyan(pm.file)}${s.gray(":")}${pm.line}  ${s.gray("→")}  ${pm.text}`
  );

  const extra = items.length - shown.length;
  if (extra > 0) {
    lines.push(s.gray(`+${extra} more location${extra === 1 ? "" : "s"}`));
  }
  return lines;
}

export interface RenderOptions {
  color: boolean;
  /** Injected for deterministic testing; defaults to the current time. */
  now?: Date;
  /** The path that was scanned, echoed in the no-scannable-files warning. */
  path?: string;
  /** One-line dataset provenance ("dataset: updated 2 days ago"), dimmed under the header. */
  datasetNote?: string;
}

/** Render the full human-readable terminal report. */
export function renderReport(result: ScanResult, opts: RenderOptions): string {
  const s = makeStyler(opts.color);
  const now = opts.now ?? new Date();
  const out: string[] = [];

  const findings = [...result.findings].sort((a, b) => {
    const sevDiff =
      SEVERITY_ORDER[effectiveSeverity(a)] - SEVERITY_ORDER[effectiveSeverity(b)];
    if (sevDiff !== 0) return sevDiff;
    // Within a severity, soonest sunset first; dateless ("deprecated") entries
    // sort last. A null/empty date maps to a far-future sentinel (no throwing).
    const da = a.deprecation.sunset_date || "9999-12-31";
    const db = b.deprecation.sunset_date || "9999-12-31";
    return da.localeCompare(db);
  });

  // Header.
  out.push("");
  out.push(
    s.bold("arol") +
      s.dim(" · local deprecation scan")
  );
  const fileWord = result.scannedFiles === 1 ? "file" : "files";
  const apiWord = findings.length === 1 ? "API" : "APIs";
  out.push(
    s.gray(
      `Scanned ${result.scannedFiles} ${fileWord} · ${findings.length} ${apiWord} detected`
    )
  );
  if (opts.datasetNote) out.push(s.gray(opts.datasetNote));
  out.push("");

  if (findings.length === 0) {
    // Scanning nothing is not a clean result. A run that walked zero source
    // files is almost always a mis-pointed path, so warn instead of giving the
    // green all-clear (which would otherwise mask a misconfigured scan).
    if (result.scannedFiles === 0) {
      out.push(
        s.bold(s.yellow("⚠ ")) +
          s.bold("No scannable files found at ") +
          s.cyan(opts.path ?? ".")
      );
      out.push("");
      out.push(
        s.gray(
          `arol scans these file types: ${SOURCE_EXTENSIONS.map((e) => `.${e}`).join(", ")}`
        )
      );
      out.push(s.gray("Double-check that the path is correct."));
      out.push("");
      return out.join("\n");
    }

    out.push(s.green(s.bold("✓ No upcoming deprecations detected in your stack.")));
    out.push("");
    out.push(footer(s, findings, now));
    return out.join("\n");
  }

  // Severity summary.
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[effectiveSeverity(f)]++;
  const summaryParts = [
    s.red(`${counts.high} high`),
    s.yellow(`${counts.medium} medium`),
    s.blue(`${counts.low} low`),
  ];
  const noun = findings.length === 1 ? "deprecation" : "deprecations";
  out.push(
    s.bold(s.yellow("⚠ ")) +
      s.bold(`${findings.length} ${noun} found`) +
      s.gray(` (${summaryParts.join(s.gray(", "))})`)
  );
  out.push("");

  // Per finding.
  for (const finding of findings) {
    const d = finding.deprecation;
    const sev = effectiveSeverity(finding);
    const sevColor = severityColor(s, sev);

    out.push(
      `${sevColor("●")} ${s.bold(d.vendor)} ${s.gray("·")} ${d.title} ${severityPill(
        s,
        sev
      )}`
    );

    // We matched a textual reference, not a confirmed call site, so frame it as
    // a reference (never "this call will fail"). Wording tracks severity: test
    // references are softened. The date fact comes from statusPhrase.
    const status = statusPhrase(s, d, now);
    if (finding.patternMatches.length > 0) {
      const subject = (d.detect.models?.length ?? 0) > 0 ? "model" : "API";
      const ref = isTestOnly(finding)
        ? `test code references a deprecated ${subject}`
        : `references a deprecated ${subject}`;
      out.push(`  ${s.dim(ref)} ${s.gray("·")} ${status}`);
    } else {
      out.push(`  ${status}`);
    }

    if (d.summary) {
      out.push(`  ${s.dim(wrapText(d.summary, 76, "  ").trimStart())}`);
    }

    // Evidence.
    out.push(`  ${s.gray("found in:")}`);
    for (const mm of finding.manifestMatches) {
      const ver = mm.version
        ? s.gray("@") + mm.version
        : s.gray(" (declared, no version)");
      out.push(`    ${s.cyan(mm.manifest)} ${s.gray("→")} ${mm.sdk}${ver}`);
    }
    for (const line of formatPatternMatches(s, finding)) {
      out.push(`    ${line}`);
    }

    if (d.migration_url) {
      out.push(`  ${s.gray("→ migrate:")} ${s.underline(s.cyan(d.migration_url))}`);
    }
    out.push("");
  }

  out.push(footer(s, findings, now));
  return out.join("\n");
}

/** Status-aware closing CTA, visually separated from the findings above. */
function footer(s: Styler, findings: Finding[], now: Date): string {
  const sep = s.dim("─".repeat(60));
  const brand = "arol.ai";

  if (findings.length === 0) {
    const message =
      s.green("✓ Clean today — but new deprecations land constantly. Stay covered → ") +
      s.cyan(s.bold(brand));
    return [sep, message].join("\n");
  }

  // The urgent line only makes sense when something actually breaks on a date:
  // a high-severity finding, or any dated (scheduled/retired) finding.
  const hasHighOrDated = findings.some(
    (f) =>
      effectiveSeverity(f) === "high" ||
      effectiveStatus(f.deprecation, now) !== "deprecated"
  );

  const message = hasHighOrDated
    ? s.bold(
        s.red(
          `⚠ These break on fixed dates. Get alerted before the next one hits you → ${brand}`
        )
      )
    : s.yellow("Deprecated APIs in your stack will be pulled eventually — stay ahead → ") +
      s.cyan(s.bold(brand));

  return [sep, message].join("\n");
}

/** Soft-wrap text to a width, indenting continuation lines. */
function wrapText(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > width && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join("\n");
}
