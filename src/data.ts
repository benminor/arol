import * as fs from "fs";
import * as path from "path";
import {
  Confidence,
  Dataset,
  Deprecation,
  MatchMode,
  Severity,
  Status,
} from "./types";
import { cachedDatasetPath, cacheMetaPath, EnvLike } from "./cache";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const MATCH_MODES: MatchMode[] = ["pattern", "sdk", "version"];
const STATUSES: Status[] = ["deprecated", "scheduled", "retired"];
const CONFIDENCES: Confidence[] = ["confirmed", "reported", "inferred"];

/**
 * Locate the bundled deprecations.json. Tries several candidate locations so the
 * tool works both when running the compiled output (dist/) from a published
 * package and when running straight from source.
 */
function defaultDataPath(): string {
  const candidates = [
    // Copied alongside compiled output (if a build step does so).
    path.join(__dirname, "data", "deprecations.json"),
    // Published layout: dist/data.js resolving back up to src/data/.
    path.join(__dirname, "..", "src", "data", "deprecations.json"),
    // Running directly from src/ (e.g. ts-node).
    path.join(__dirname, "..", "data", "deprecations.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to the first candidate so the error message is meaningful.
  return candidates[0];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Validate and normalize a single raw entry, or return null if it is malformed. */
function coerceDeprecation(raw: unknown): Deprecation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyString(r.id)) return null;
  if (!isNonEmptyString(r.vendor)) return null;
  if (!isNonEmptyString(r.title)) return null;
  if (!SEVERITIES.includes(r.severity as Severity)) return null;

  const detect = r.detect as Record<string, unknown> | undefined;
  // detect.sdk is now FUNCTIONAL for match:"pattern" entries (import-gating, see
  // imports.ts): a non-empty sdk means the entry's patterns only run in files that
  // import a matching package. Empty sdk = ungated (patterns run everywhere).
  const sdk = detect && isStringArray(detect.sdk) ? detect.sdk : [];
  const patterns =
    detect && isStringArray(detect.patterns) ? detect.patterns : [];
  const models =
    detect && isStringArray(detect.models) ? detect.models : [];

  // Omitted (or null) match defaults to "pattern" — detection keys on real
  // usage, not SDK presence. An entry with an UNKNOWN match mode is dropped
  // entirely (fail closed): it was authored for a newer CLI, and since the
  // dataset auto-updates independently of the binary, running its signals
  // under the wrong semantics is worse than skipping it.
  if (r.match != null && !MATCH_MODES.includes(r.match as MatchMode)) {
    return null;
  }
  const match: MatchMode = MATCH_MODES.includes(r.match as MatchMode)
    ? (r.match as MatchMode)
    : "pattern";
  const version_range = isNonEmptyString(r.version_range)
    ? r.version_range
    : undefined;

  // Dateless deprecations: null / missing / "" all mean "no removal date".
  const sunset_date = isNonEmptyString(r.sunset_date) ? r.sunset_date : null;
  // Provenance: when the vendor announced it (null = unknown), the notice URL,
  // and how well-evidenced the claims are. An invalid confidence is dropped
  // (undefined = unspecified) rather than guessed.
  const announced_date = isNonEmptyString(r.announced_date)
    ? r.announced_date
    : null;
  const confidence = CONFIDENCES.includes(r.confidence as Confidence)
    ? (r.confidence as Confidence)
    : undefined;
  // Honor an explicit, valid status; otherwise leave it for runtime derivation.
  const status = STATUSES.includes(r.status as Status)
    ? (r.status as Status)
    : undefined;

  // Language scoping: extensions this entry's patterns are valid in.
  // Normalize to lowercase, dot-stripped; default to ["*"] (match any file).
  const applies_to =
    isStringArray(r.applies_to) && r.applies_to.length > 0
      ? r.applies_to.map((e) => e.toLowerCase().replace(/^\./, ""))
      : ["*"];

  // Drop entries that can never fire under their match mode.
  // A "pattern" entry fires on either a raw pattern OR a model-string match.
  if (match === "pattern" && patterns.length === 0 && models.length === 0)
    return null;
  if ((match === "sdk" || match === "version") && sdk.length === 0) return null;

  // INVARIANT: every array below is always defined here — detect.{sdk,patterns,
  // models} default to [] and applies_to to ["*"] (above). scanner.ts depends on
  // this and also guards with `?? []` as defense in depth. Don't drop the defaults.
  return {
    id: r.id,
    vendor: r.vendor,
    title: r.title,
    severity: r.severity as Severity,
    match,
    status,
    applies_to,
    sunset_date,
    announced_date,
    source: typeof r.source === "string" ? r.source : "",
    confidence,
    detect: { sdk, patterns, models },
    version_range,
    migration_url: typeof r.migration_url === "string" ? r.migration_url : "",
    summary: typeof r.summary === "string" ? r.summary : "",
  };
}

/**
 * Parse and validate dataset text (the contents of a deprecations.json).
 * Shared by the file loader below and by `arol-ai update`, so a remote
 * dataset passes exactly the same validation as a local one.
 * @param contents raw JSON text.
 * @param label where the text came from — used in error messages.
 */
export function parseDeprecations(contents: string, label: string): Deprecation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(
      `deprecations dataset is not valid JSON (${label}): ${
        (err as Error).message
      }`
    );
  }

  // Accept either the full { deprecations: [...] } shape or a bare array.
  const rawList: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as Dataset)?.deprecations;

  if (!Array.isArray(rawList)) {
    throw new Error(
      `deprecations dataset must contain a "deprecations" array (${label}).`
    );
  }

  const deprecations: Deprecation[] = [];
  for (const raw of rawList) {
    const entry = coerceDeprecation(raw);
    if (entry) deprecations.push(entry);
  }
  return deprecations;
}

/**
 * Load and validate the deprecations dataset.
 * @param customPath optional path to an alternative dataset file.
 */
export function loadDeprecations(customPath?: string): Deprecation[] {
  const file = customPath ? path.resolve(customPath) : defaultDataPath();

  let contents: string;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`Could not read deprecations dataset at: ${file}`);
  }

  return parseDeprecations(contents, file);
}

export type DatasetOrigin = "custom" | "cache" | "bundled";

/** Which dataset file a scan will read, and how fresh it is. */
export interface DatasetSource {
  path: string;
  origin: DatasetOrigin;
  /** ISO timestamp of the last successful `update`, for cache origin only. */
  fetchedAt: string | null;
}

/**
 * Pick the dataset for a scan: an explicit --data file always wins; otherwise
 * the auto-updated cache when one exists; otherwise the bundled dataset that
 * shipped with this CLI version.
 */
export function resolveDatasetSource(
  customPath?: string,
  env: EnvLike = process.env
): DatasetSource {
  if (customPath) {
    return { path: path.resolve(customPath), origin: "custom", fetchedAt: null };
  }
  const cached = cachedDatasetPath(env);
  if (fs.existsSync(cached)) {
    let fetchedAt: string | null = null;
    try {
      const meta = JSON.parse(fs.readFileSync(cacheMetaPath(env), "utf8"));
      if (typeof meta?.fetchedAt === "string") fetchedAt = meta.fetchedAt;
    } catch {
      /* missing/corrupt meta only costs the freshness label */
    }
    return { path: cached, origin: "cache", fetchedAt };
  }
  return { path: defaultDataPath(), origin: "bundled", fetchedAt: null };
}

export interface LoadedDataset {
  deprecations: Deprecation[];
  source: DatasetSource;
  /** Set when the cache was unusable and the bundled dataset was used instead. */
  warning?: string;
}

/**
 * Load the dataset for a scan with the resolution above. A corrupt cache must
 * never brick the scan: fall back to the bundled dataset and say so. Errors in
 * an explicit --data file still throw — the user asked for that exact file.
 */
export function loadForScan(
  customPath?: string,
  env: EnvLike = process.env
): LoadedDataset {
  const source = resolveDatasetSource(customPath, env);
  try {
    return { deprecations: loadDeprecations(source.path), source };
  } catch (err) {
    if (source.origin !== "cache") throw err;
    const bundled: DatasetSource = {
      path: defaultDataPath(),
      origin: "bundled",
      fetchedAt: null,
    };
    return {
      deprecations: loadDeprecations(bundled.path),
      source: bundled,
      warning: `cached dataset was invalid (${(err as Error).message}); used the bundled dataset — run arol-ai update`,
    };
  }
}
