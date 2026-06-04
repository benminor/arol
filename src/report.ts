import { Finding, ScanResult, Severity } from "./types";

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

/** Render the sunset date with a relative hint, or a note when there is no date. */
function sunsetPhrase(s: Styler, sunsetDate: string, now: Date): string {
  if (!sunsetDate) {
    return s.gray("no fixed sunset date — already deprecated / unmaintained");
  }
  const parsed = new Date(`${sunsetDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return s.gray(`sunsets ${sunsetDate}`);
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((parsed.getTime() - now.getTime()) / msPerDay);
  let rel: string;
  if (days > 1) rel = `in ${days} days`;
  else if (days === 1) rel = "in 1 day";
  else if (days === 0) rel = "today";
  else if (days === -1) rel = "1 day ago";
  else rel = `${Math.abs(days)} days ago`;

  const base = `sunsets ${sunsetDate}`;
  const hint = days <= 0 ? ` (passed ${rel})` : ` (${rel})`;
  // Past or imminent sunsets are the urgent ones.
  return days <= 30 ? s.red(base + hint) : s.yellow(base + hint);
}

/** Group pattern matches by file into "path:line, line" summaries. */
function formatPatternMatches(s: Styler, finding: Finding): string[] {
  const byFile = new Map<string, number[]>();
  for (const pm of finding.patternMatches) {
    const arr = byFile.get(pm.file) ?? [];
    arr.push(pm.line);
    byFile.set(pm.file, arr);
  }
  const lines: string[] = [];
  for (const [file, nums] of byFile) {
    const uniqueSorted = Array.from(new Set(nums)).sort((a, b) => a - b);
    const shown = uniqueSorted.slice(0, 8);
    const more =
      uniqueSorted.length > shown.length
        ? s.gray(` +${uniqueSorted.length - shown.length} more`)
        : "";
    lines.push(`${s.cyan(file)}${s.gray(":")}${shown.join(s.gray(", "))}${more}`);
  }
  return lines;
}

export interface RenderOptions {
  color: boolean;
  /** Injected for deterministic testing; defaults to the current time. */
  now?: Date;
}

/** Render the full human-readable terminal report. */
export function renderReport(result: ScanResult, opts: RenderOptions): string {
  const s = makeStyler(opts.color);
  const now = opts.now ?? new Date();
  const out: string[] = [];

  const findings = [...result.findings].sort((a, b) => {
    const sevDiff =
      SEVERITY_ORDER[a.deprecation.severity] -
      SEVERITY_ORDER[b.deprecation.severity];
    if (sevDiff !== 0) return sevDiff;
    // Within a severity, soonest/earliest sunset first; undated last.
    const da = a.deprecation.sunset_date || "9999-99-99";
    const db = b.deprecation.sunset_date || "9999-99-99";
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
  out.push("");

  if (findings.length === 0) {
    out.push(s.green(s.bold("✓ No upcoming deprecations detected in your stack.")));
    out.push("");
    out.push(footer(s));
    return out.join("\n");
  }

  // Severity summary.
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.deprecation.severity]++;
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
    const sevColor = severityColor(s, d.severity);

    out.push(
      `${sevColor("●")} ${s.bold(d.vendor)} ${s.gray("·")} ${d.title} ${severityPill(
        s,
        d.severity
      )}`
    );
    out.push(`  ${sunsetPhrase(s, d.sunset_date, now)}`);

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

  out.push(footer(s));
  return out.join("\n");
}

function footer(s: Styler): string {
  return [
    s.dim("─".repeat(60)),
    s.dim("These are today's deprecations. New ones land constantly — get"),
    s.dim("alerted before the next one breaks you → ") + s.cyan(s.bold("arol.ai")),
  ].join("\n");
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
