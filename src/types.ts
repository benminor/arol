export type Severity = "high" | "medium" | "low";

/** What signals indicate a deprecation is in use. */
export interface Detect {
  /** Dependency / module names to look for in manifests (package.json, requirements.txt, go.mod). */
  sdk: string[];
  /** Regular-expression strings matched against source file contents. */
  patterns: string[];
}

/** One entry in deprecations.json. */
export interface Deprecation {
  id: string;
  vendor: string;
  title: string;
  severity: Severity;
  /** ISO date (YYYY-MM-DD) the API sunsets / loses support, or "" if there is no fixed date. */
  sunset_date: string;
  detect: Detect;
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

/** A single source-line that matched one of a deprecation's detect.patterns. */
export interface PatternMatch {
  /** Repo-relative path of the source file. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The trimmed text of the matching line. */
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
