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

/** Source file extensions that get the inline regex scan. */
const SOURCE_EXTENSIONS = [
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

/** Directories never worth walking. */
const IGNORED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".venv",
  "venv",
  "vendor",
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
}

/** Skip files larger than this (bytes) to keep the scan fast. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Cap matches recorded per pattern per file to avoid pathological output. */
const MAX_MATCHES_PER_PATTERN_PER_FILE = 50;

/** A deprecation with its patterns pre-compiled once. */
interface CompiledDeprecation {
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
 * an opening quote, the (escaped) family name, an optional version/suffix, then
 * the SAME closing quote. So a quoted model id (single, double, or backtick)
 * and its versioned snapshots match, but never a bare occurrence in
 * prose/JSX/markdown.
 */
function modelRegexSource(family: string): string {
  return `(${QUOTE_CLASS})${escapeRegex(family)}[A-Za-z0-9._-]*\\1`;
}

function compileDeprecations(deprecations: Deprecation[]): CompiledDeprecation[] {
  return deprecations.map((deprecation) => {
    const regexes: RegExp[] = [];
    // Raw patterns — code identifiers, endpoints, params.
    for (const pattern of deprecation.detect.patterns) {
      try {
        // Global so we can iterate every match and derive line numbers.
        regexes.push(new RegExp(pattern, "g"));
      } catch {
        // A malformed pattern in the dataset must not crash the scan.
      }
    }
    // Model names — only matched inside string literals (quote-anchored).
    for (const family of deprecation.detect.models) {
      try {
        regexes.push(new RegExp(modelRegexSource(family), "g"));
      } catch {
        // Defensive: a pathological family name must not crash the scan.
      }
    }
    return { deprecation, regexes };
  });
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

/** Match every compiled deprecation against one file's contents. */
function scanContent(
  content: string,
  relPath: string,
  compiled: CompiledDeprecation[],
  sink: Map<string, PatternMatch[]>
): void {
  const lineStarts = computeLineStarts(content);

  for (const { deprecation, regexes } of compiled) {
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
    if (deprecation.detect.sdk.length === 0) continue;
    const matches: ManifestMatch[] = [];
    const seen = new Set<string>();
    for (const sdk of deprecation.detect.sdk) {
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

  // Assemble the ignore list: dirs + default file skips + .arolignore + --ignore.
  const ignoreGlobs = [
    ...IGNORED_DIRS.map((d) => `**/${d}/**`),
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
      dot: false,
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
    scanContent(content, rel, compiled, patternSink);
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
