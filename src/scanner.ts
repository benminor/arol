import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";
import {
  Deprecation,
  Finding,
  ManifestMatch,
  PatternMatch,
  ScanResult,
} from "./types";
import { collectManifestDeps, nameMatches, PkgRef } from "./manifests";
import {
  extractImports,
  importsSatisfySdk,
  isGateableLang,
  NO_IMPORTS,
} from "./imports";

/** Source file extensions that get the inline regex scan. */
export const SOURCE_EXTENSIONS = [
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "py",
  "go",
];

/**
 * Dependency & build directories skipped by default — a user can't fix a
 * deprecation inside vendored/generated code. `--include-deps` (ScanOptions
 * .includeDeps) opts back in. Centralized here so it's trivial to extend.
 *
 * Note: dot-prefixed entries (.venv, .next, .git) are also covered by fast-glob's
 * `dot: false` default; they're listed here so a single flag re-enables them too.
 */
const DEPENDENCY_DIRS = [
  // JS / TS
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  // Python
  ".venv",
  "venv",
  "env",
  "site-packages",
  "__pycache__",
  // Other ecosystems / VCS
  "vendor",
  "target",
  ".git",
];

/**
 * Files always skipped by default: documentation/prose (where model names show
 * up as text, not code) and the tool's own dataset / config files.
 */
const DEFAULT_FILE_IGNORES = [
  "**/*.md",
  "**/*.mdx",
  "**/*.txt",
  "**/deprecations.json",
  "**/.arolignore",
  "**/arol.config.*",
];

/** Options controlling which files the scan walks. */
export interface ScanOptions {
  /** Extra ignore globs (e.g. from repeated --ignore flags). */
  ignore?: string[];
  /** Path to a custom dataset (--data) to also exclude from scanning. */
  dataPath?: string;
  /**
   * Scan into dependency/build dirs (and dot-dirs) too. Off by default — those
   * hold code the user can't fix. Set by the --include-deps flag.
   */
  includeDeps?: boolean;
}

/** Skip files larger than this (bytes) to keep the scan fast. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Cap matches recorded per pattern per file to avoid pathological output. */
const MAX_MATCHES_PER_PATTERN_PER_FILE = 50;

/** A deprecation with its patterns pre-compiled once. */
interface CompiledDeprecation {
  deprecation: Deprecation;
  /** Regexes from detect.patterns — subject to import-gating. */
  patternRegexes: RegExp[];
  /** Regexes from detect.models — NEVER gated (model strings run regardless). */
  modelRegexes: RegExp[];
  /** Lowercased extensions this entry applies to; `*` means any. */
  appliesTo: Set<string>;
  /**
   * detect.sdk — the import gate for this entry's patternRegexes. Empty means
   * "ungated" (patterns run everywhere, as before import-gating).
   */
  sdkGate: string[];
}

/** The regexes selected to run against one file for one deprecation. */
interface RegexRun {
  deprecation: Deprecation;
  regexes: RegExp[];
}

/** Any of the three string-literal quote characters. */
const QUOTE_CLASS = "['\"`]";

/** Escape regex metacharacters in a literal model family name. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex that matches a model family ONLY inside a string literal:
 * an opening quote, the (escaped) family name, an OPTIONAL ISO date snapshot
 * suffix (e.g. -2024-05-13), then the SAME closing quote. No arbitrary trailing
 * characters are allowed, so "gpt-4o" matches "gpt-4o" and "gpt-4o-2024-05-13"
 * but never a different model like "gpt-4o-mini" or "gpt-4o-realtime-preview".
 * The model is still only found inside a quoted literal, never in bare prose.
 */
export function modelRegexSource(family: string): string {
  return `(${QUOTE_CLASS})${escapeRegex(family)}(?:-\\d{4}-\\d{2}-\\d{2})?\\1`;
}

function compileDeprecations(deprecations: Deprecation[]): CompiledDeprecation[] {
  return deprecations.map((deprecation) => {
    const patternRegexes: RegExp[] = [];
    // Raw patterns — code identifiers, endpoints, params.
    // `?? []` guards against entries not produced by the loader (e.g. tests).
    for (const pattern of deprecation.detect.patterns ?? []) {
      try {
        // Global so we can iterate every match and derive line numbers.
        patternRegexes.push(new RegExp(pattern, "g"));
      } catch {
        // A malformed pattern in the dataset must not crash the scan.
      }
    }
    // Model names — only matched inside string literals (quote-anchored).
    const modelRegexes: RegExp[] = [];
    for (const family of deprecation.detect.models ?? []) {
      try {
        modelRegexes.push(new RegExp(modelRegexSource(family), "g"));
      } catch {
        // Defensive: a pathological family name must not crash the scan.
      }
    }
    // Missing/empty applies_to means "applies everywhere" (["*"]), preserved here.
    const declaredExts = deprecation.applies_to ?? [];
    const appliesTo = new Set(
      (declaredExts.length > 0 ? declaredExts : ["*"]).map((e) => e.toLowerCase())
    );
    return {
      deprecation,
      patternRegexes,
      modelRegexes,
      appliesTo,
      sdkGate: deprecation.detect.sdk ?? [],
    };
  });
}

/** True if a compiled entry should be tested against a file with this extension. */
function appliesToExt(compiled: CompiledDeprecation, ext: string): boolean {
  return compiled.appliesTo.has("*") || compiled.appliesTo.has(ext);
}

/** Per-language comment + string syntax used to de-comment source before matching. */
interface LangComments {
  /** Line-comment starters (rest of line is a comment). */
  line: string[];
  /** Block-comment open/close pairs (the C-style pair also covers JSX comments). */
  block: [string, string][];
  /** Single-char string delimiters (content is preserved, never stripped). */
  strings: string[];
  /** Triple-char string delimiters (e.g. Python docstrings). */
  triple: string[];
}

function commentConfig(ext: string): LangComments | null {
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
    case "go":
      return { line: ["//"], block: [["/*", "*/"]], strings: ["'", '"', "`"], triple: [] };
    case "py":
      return { line: ["#"], block: [], strings: ["'", '"'], triple: ['"""', "'''"] };
    default:
      return null;
  }
}

/**
 * Replace comments with spaces so they don't match, while preserving the exact
 * byte length and all newlines — line/column offsets stay correct. String literals
 * (including their contents) are left intact, so a comment marker inside a string
 * (e.g. "https://…") is NOT treated as a comment.
 */
function stripComments(src: string, cfg: LangComments): string {
  const out = src.split("");
  const n = src.length;
  const at = (s: string, i: number): boolean => src.startsWith(s, i);
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };

  let i = 0;
  while (i < n) {
    // Triple-quoted strings (Python) — checked before single quotes.
    let matched = false;
    for (const t of cfg.triple) {
      if (at(t, i)) {
        i += t.length;
        while (i < n && !at(t, i)) i++;
        i += t.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Ordinary string literals — preserve contents verbatim.
    for (const q of cfg.strings) {
      if (src[i] === q) {
        i++;
        while (i < n && src[i] !== q) {
          if (src[i] === "\\") i++; // skip escaped char
          i++;
        }
        i++; // closing quote (or past end if unterminated)
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Block comments.
    for (const [open, close] of cfg.block) {
      if (at(open, i)) {
        const end = src.indexOf(close, i + open.length);
        const stop = end === -1 ? n : end + close.length;
        blank(i, stop);
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Line comments.
    for (const lc of cfg.line) {
      if (at(lc, i)) {
        let k = i;
        while (k < n && src[k] !== "\n") k++;
        blank(i, k);
        i = k;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    i++;
  }
  return out.join("");
}

/** Precompute the byte offset at which each line starts. */
function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/** Map a character offset to a 1-based line number via binary search. */
function lineNumberAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1;
}

/** Match the selected regexes for each deprecation against one file's contents. */
function scanContent(
  content: string,
  relPath: string,
  runs: RegexRun[],
  sink: Map<string, PatternMatch[]>
): void {
  const lineStarts = computeLineStarts(content);

  for (const { deprecation, regexes } of runs) {
    if (regexes.length === 0) continue;
    let recorded = sink.get(deprecation.id);

    for (const baseRe of regexes) {
      // Use a fresh regex instance per file so lastIndex never leaks across files.
      const re = new RegExp(baseRe.source, baseRe.flags);
      let count = 0;
      let m: RegExpExecArray | null;
      const seenLines = new Set<number>();

      while ((m = re.exec(content)) !== null) {
        // Guard against zero-width matches looping forever.
        if (m.index === re.lastIndex) re.lastIndex++;

        const line = lineNumberAt(lineStarts, m.index);
        if (seenLines.has(line)) continue; // one record per line per pattern
        seenLines.add(line);

        // Cite the matched substring itself, normalized and length-capped, so
        // the report points at exactly what triggered the finding.
        const text = (m[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

        if (!recorded) {
          recorded = [];
          sink.set(deprecation.id, recorded);
        }
        recorded.push({ file: relPath, line, text });

        if (++count >= MAX_MATCHES_PER_PATTERN_PER_FILE) break;
      }
    }
  }
}

/** Find dependencies in the collected manifest refs that match each deprecation. */
function matchManifests(
  deprecations: Deprecation[],
  refs: PkgRef[]
): Map<string, ManifestMatch[]> {
  const byId = new Map<string, ManifestMatch[]>();
  for (const deprecation of deprecations) {
    const sdks = deprecation.detect.sdk ?? [];
    if (sdks.length === 0) continue;
    const matches: ManifestMatch[] = [];
    const seen = new Set<string>();
    for (const sdk of sdks) {
      for (const ref of refs) {
        if (!nameMatches(sdk, ref.name)) continue;
        const key = `${ref.source}::${ref.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ manifest: ref.source, sdk: ref.name, version: ref.version });
      }
    }
    if (matches.length > 0) byId.set(deprecation.id, matches);
  }
  return byId;
}

/** Best-effort parse of a dotted numeric version from a declared string. */
function parseVersionNumbers(raw: string | null): number[] | null {
  if (!raw) return null;
  // Pull the first dotted-number run, ignoring ^ ~ >= <= operators and a "v" prefix.
  const m = /(\d+(?:\.\d+)*)/.exec(raw);
  if (!m) return null;
  return m[1].split(".").map((n) => parseInt(n, 10));
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Best-effort check that a declared version satisfies a simple range such as
 * "<3.0.0", ">=1.2.0", or "=2.1.0" / "2.1.0". Semver-ish: compares dotted numbers.
 * Returns true when no range is given; false when a range is required but the
 * declared version can't be parsed (stay conservative — don't over-flag).
 */
function versionInRange(declared: string | null, range: string | undefined): boolean {
  if (!range) return true; // no constraint → presence already established by caller
  const rm = /^\s*(<=|>=|<|>|={1,3})?\s*v?(\d+(?:\.\d+)*)\s*$/.exec(range);
  if (!rm) return true; // unparseable range → don't invent a false constraint
  const op = rm[1] || "=";
  const target = rm[2].split(".").map((n) => parseInt(n, 10));
  const have = parseVersionNumbers(declared);
  if (!have) return false;
  const cmp = compareVersions(have, target);
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    default:
      return cmp === 0;
  }
}

/**
 * Convert one .arolignore line (gitignore-style) into fast-glob ignore globs.
 * Supports comments (#), blank lines, leading "/" anchoring, and trailing "/"
 * for directories. Negations ("!") are not supported and are skipped.
 */
function arolignoreLineToGlobs(rawLine: string): string[] {
  let line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("!")) return [];

  const anchored = line.startsWith("/");
  if (anchored) line = line.slice(1);
  const isDir = line.endsWith("/");
  if (isDir) line = line.replace(/\/+$/, "");
  if (!line) return [];

  const base = anchored ? line : `**/${line}`;
  // A directory ignore covers its contents; a file/glob ignore covers both the
  // entry itself and (harmlessly) anything beneath it if it is a directory.
  return isDir ? [`${base}/**`] : [base, `${base}/**`];
}

/** Read and parse a repo's .arolignore file into ignore globs (empty if none). */
function loadArolignore(root: string): string[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(root, ".arolignore"), "utf8");
  } catch {
    return [];
  }
  return content.split(/\r?\n/).flatMap(arolignoreLineToGlobs);
}

/**
 * Scan a repository for deprecation usage.
 * @param root repo root to scan.
 * @param deprecations validated dataset entries.
 * @param options optional ignore globs (--ignore) and custom dataset path.
 */
export function scanRepo(
  root: string,
  deprecations: Deprecation[],
  options: ScanOptions = {}
): ScanResult {
  const absRoot = path.resolve(root);

  // Assemble the ignore list. Dependency/build dirs are skipped unless the user
  // opts in with --include-deps; doc/config skips, .arolignore, and --ignore
  // always apply.
  const ignoreGlobs = [
    ...(options.includeDeps ? [] : DEPENDENCY_DIRS.map((d) => `**/${d}/**`)),
    ...DEFAULT_FILE_IGNORES,
    ...loadArolignore(absRoot),
    ...(options.ignore ?? []),
  ];
  // Never scan the active custom dataset file, even if it lives in the tree.
  if (options.dataPath) {
    const relData = path.relative(absRoot, path.resolve(options.dataPath));
    if (relData && !relData.startsWith("..") && !path.isAbsolute(relData)) {
      ignoreGlobs.push(relData);
    }
  }

  // Partition by match mode: "pattern" entries key on real source usage, while
  // "sdk"/"version" entries key on the manifest.
  const patternDeps = deprecations.filter((d) => d.match === "pattern");
  const manifestDeps = deprecations.filter(
    (d) => d.match === "sdk" || d.match === "version"
  );

  // 1. Manifest scan (drives sdk/version entries; also lists the manifests read).
  const { refs, manifests } = collectManifestDeps(absRoot);
  const manifestMatches = matchManifests(manifestDeps, refs);

  // 2. Inline source scan (drives pattern entries — usage, not mere presence).
  const compiled = compileDeprecations(patternDeps);
  const patternSink = new Map<string, PatternMatch[]>();

  const files = fg.sync(
    [`**/*.{${SOURCE_EXTENSIONS.join(",")}}`],
    {
      cwd: absRoot,
      absolute: false,
      onlyFiles: true,
      // Dot-dirs (.venv, .next, .git) are skipped by default; --include-deps
      // re-enables them alongside the dependency dirs above.
      dot: options.includeDeps === true,
      followSymbolicLinks: false,
      suppressErrors: true,
      ignore: ignoreGlobs,
    }
  );

  let scannedFiles = 0;
  for (const rel of files) {
    const abs = path.join(absRoot, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    scannedFiles++;

    // Language scoping: only test entries valid for this file's extension.
    const ext = path.extname(rel).slice(1).toLowerCase();
    const applicable = compiled.filter((c) => appliesToExt(c, ext));
    if (applicable.length === 0) continue;

    // Comment stripping: match against de-commented source so mentions in
    // comments don't count. Offsets are preserved, so line numbers stay correct.
    const cfg = commentConfig(ext);
    const scanText = cfg ? stripComments(content, cfg) : content;

    // Import-gating: parse imports ONCE per file, reused across all entries.
    // Only needed when some applicable entry actually gates (non-empty sdk) and
    // the language supports gating (Go/unknown fall back to ungated). TODO: gate Go.
    const gateable = isGateableLang(ext);
    const needImports = gateable && applicable.some((c) => c.sdkGate.length > 0);
    const imports = needImports ? extractImports(scanText, ext) : NO_IMPORTS;

    // For each entry: model regexes always run; pattern regexes run only when the
    // gate is open (empty sdk → always; non-gateable lang → always; else the file
    // must import a matching package).
    const runs: RegexRun[] = [];
    for (const c of applicable) {
      const gateOpen =
        c.sdkGate.length === 0 ||
        !gateable ||
        importsSatisfySdk(c.sdkGate, imports);
      const regexes = gateOpen
        ? [...c.modelRegexes, ...c.patternRegexes]
        : c.modelRegexes;
      if (regexes.length > 0) runs.push({ deprecation: c.deprecation, regexes });
    }
    if (runs.length > 0) scanContent(scanText, rel, runs, patternSink);
  }

  // 3. Build findings — one per deprecation, evaluated per its match mode.
  const findings: Finding[] = [];
  for (const deprecation of deprecations) {
    if (deprecation.match === "pattern") {
      // Flag ONLY on a real source hit; manifest/SDK presence is irrelevant here.
      const pm = patternSink.get(deprecation.id) ?? [];
      if (pm.length === 0) continue;
      findings.push({ deprecation, manifestMatches: [], patternMatches: pm });
      continue;
    }

    // "sdk" / "version": evaluate against the manifest.
    const mm = manifestMatches.get(deprecation.id) ?? [];
    if (mm.length === 0) continue;

    if (deprecation.match === "version") {
      const inRange = mm.filter((m) =>
        versionInRange(m.version, deprecation.version_range)
      );
      if (inRange.length === 0) continue;
      findings.push({ deprecation, manifestMatches: inRange, patternMatches: [] });
      continue;
    }

    // "sdk": mere presence in a manifest is enough.
    findings.push({ deprecation, manifestMatches: mm, patternMatches: [] });
  }

  return { scannedFiles, manifestsScanned: manifests, findings };
}
