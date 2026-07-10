export type Severity = "high" | "medium" | "low";

/**
 * Lifecycle status of a deprecation:
 * - "deprecated": announced but with no removal date (sunset_date is null).
 * - "scheduled": has a future sunset_date — it will break on that day.
 * - "retired": its sunset_date is in the past — it is already removed/broken.
 *
 * When an entry omits `status`, it is derived at runtime from sunset_date vs today.
 */
export type Status = "deprecated" | "scheduled" | "retired";

/**
 * How a deprecation entry is triggered:
 * - "pattern" (default): flag ONLY when detect.patterns or detect.models match in a
 *   scanned source file. Manifest presence alone never triggers. When detect.sdk is
 *   non-empty, patterns are import-gated (JS/TS/Python); models are never gated.
 * - "sdk": flag when a detect.sdk package appears in a manifest, regardless of code.
 * - "version": flag when a detect.sdk package appears in a manifest AND its declared
 *   version satisfies version_range (when one is given).
 */
export type MatchMode = "pattern" | "sdk" | "version";

/** What signals indicate a deprecation is in use. */
export interface Detect {
  /**
   * Package / module names. For match:"pattern": import gate for `patterns` —
   * patterns only run in files that import a matching package (JS/TS/Python);
   * empty means ungated. Model matches are never import-gated. For
   * match:"sdk"/"version": the manifest trigger (package.json, requirements.txt,
   * go.mod).
   */
  sdk: string[];
  /**
   * Raw regex strings matched against source file contents. Use for code
   * identifiers, endpoint paths, and query params (method names, route
   * fragments, auth params) — anything that is not a bare model id.
   * Subject to import-gating when detect.sdk is non-empty.
   */
  patterns: string[];
  /**
   * Model family names matched ONLY when they appear inside a string literal.
   * Each becomes a regex of: an opening quote (' " or `), the escaped family
   * name, an OPTIONAL ISO date snapshot suffix (-YYYY-MM-DD), then the matching
   * closing quote. So a quoted model id and its dated snapshots match exactly
   * ("gpt-4o" and "gpt-4o-2024-05-13"), but never a different model
   * ("gpt-4o-mini") and never a bare occurrence in prose/JSX/markdown.
   * Not subject to import-gating.
   */
  models: string[];
}

/** One entry in deprecations.json. */
export interface Deprecation {
  id: string;
  vendor: string;
  title: string;
  severity: Severity;
  /** How the entry is triggered. Defaults to "pattern" when omitted in the dataset. */
  match: MatchMode;
  /**
   * Explicit lifecycle status. Optional — when omitted it is derived at runtime
   * from sunset_date (null → "deprecated", past → "retired", future → "scheduled").
   * An explicit value here is always honored.
   */
  status?: Status;
  /**
   * File extensions (without the dot, lowercased) this entry's patterns/models are
   * valid in — e.g. ["py"], ["js","ts","jsx","tsx","mjs"], or ["*"] to match any
   * scanned file. The inline scan only tests an entry against files whose extension
   * is listed here. Defaults to ["*"] when omitted.
   */
  applies_to: string[];
  /** ISO date (YYYY-MM-DD) the API sunsets / loses support, or null when no date is announced. */
  sunset_date: string | null;
  detect: Detect;
  /**
   * For match:"version" only — a simple range the declared SDK version must satisfy
   * to flag, e.g. "<3.0.0", ">=1.2.0", "=2.1.0". Optional; if omitted, a "version"
   * entry behaves like "sdk" (flags on mere presence).
   */
  version_range?: string;
  migration_url: string;
  summary: string;
}

/** Top-level shape of the bundled dataset. */
export interface Dataset {
  schema_version?: number;
  updated?: string;
  deprecations: Deprecation[];
}

/** A dependency found in a manifest that matches a deprecation's detect.sdk list. */
export interface ManifestMatch {
  /** Repo-relative path of the manifest the dependency was declared in. */
  manifest: string;
  /** The dependency name as it appears in the manifest. */
  sdk: string;
  /** The declared version / constraint, or null if none was present. */
  version: string | null;
}

/** A single source location that matched one of a deprecation's detect.patterns. */
export interface PatternMatch {
  /** Repo-relative path of the source file. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The matched text (the substring that the pattern matched). */
  text: string;
}

/** A deprecation that was detected, with the evidence for it. */
export interface Finding {
  deprecation: Deprecation;
  manifestMatches: ManifestMatch[];
  patternMatches: PatternMatch[];
}

/** Full result of scanning a repository. */
export interface ScanResult {
  /** Number of source files walked during the inline scan. */
  scannedFiles: number;
  /** Manifest files that were found and parsed. */
  manifestsScanned: string[];
  findings: Finding[];
}
