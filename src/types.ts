export type Severity = "high" | "medium" | "low";

/**
 * How a deprecation entry is triggered:
 * - "pattern" (default): flag ONLY when one of detect.patterns matches in a scanned
 *   source file. detect.sdk is a scope hint here, never a trigger.
 * - "sdk": flag when a detect.sdk package appears in a manifest, regardless of code.
 * - "version": flag when a detect.sdk package appears in a manifest AND its declared
 *   version satisfies version_range (when one is given).
 */
export type MatchMode = "pattern" | "sdk" | "version";

/** What signals indicate a deprecation is in use. */
export interface Detect {
  /**
   * Dependency / module names to look for in manifests (package.json,
   * requirements.txt, go.mod). For match:"pattern" entries this is only a scope
   * hint and is NOT a trigger; it is the trigger for match:"sdk"/"version".
   */
  sdk: string[];
  /**
   * Raw regex strings matched against source file contents. Use for code
   * identifiers, endpoint paths, and query params (method names, route
   * fragments, auth params) — anything that is not a bare model id.
   */
  patterns: string[];
  /**
   * Model family names matched ONLY when they appear inside a string literal.
   * Each becomes a regex of: an opening quote (' " or `), the escaped family
   * name, an optional [A-Za-z0-9._-]* version/suffix, then the matching closing
   * quote. So a quoted model id (single, double, or backtick) and its versioned
   * snapshots match, while a bare occurrence in prose/JSX/markdown does not.
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
   * File extensions (without the dot, lowercased) this entry's patterns/models are
   * valid in — e.g. ["py"], ["js","ts","jsx","tsx","mjs"], or ["*"] to match any
   * scanned file. The inline scan only tests an entry against files whose extension
   * is listed here. Defaults to ["*"] when omitted.
   */
  applies_to: string[];
  /** ISO date (YYYY-MM-DD) the API sunsets / loses support, or "" if there is no fixed date. */
  sunset_date: string;
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
