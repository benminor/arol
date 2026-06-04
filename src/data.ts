import * as fs from "fs";
import * as path from "path";
import { Dataset, Deprecation, MatchMode, Severity } from "./types";

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const MATCH_MODES: MatchMode[] = ["pattern", "sdk", "version"];

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
  const sdk = detect && isStringArray(detect.sdk) ? detect.sdk : [];
  const patterns =
    detect && isStringArray(detect.patterns) ? detect.patterns : [];

  // Default to "pattern" — detection keys on real usage, not SDK presence.
  const match: MatchMode = MATCH_MODES.includes(r.match as MatchMode)
    ? (r.match as MatchMode)
    : "pattern";
  const version_range = isNonEmptyString(r.version_range)
    ? r.version_range
    : undefined;

  // Drop entries that can never fire under their match mode.
  if (match === "pattern" && patterns.length === 0) return null;
  if ((match === "sdk" || match === "version") && sdk.length === 0) return null;

  return {
    id: r.id,
    vendor: r.vendor,
    title: r.title,
    severity: r.severity as Severity,
    match,
    sunset_date: typeof r.sunset_date === "string" ? r.sunset_date : "",
    detect: { sdk, patterns },
    version_range,
    migration_url: typeof r.migration_url === "string" ? r.migration_url : "",
    summary: typeof r.summary === "string" ? r.summary : "",
  };
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(
      `deprecations dataset is not valid JSON (${file}): ${
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
      `deprecations dataset must contain a "deprecations" array (${file}).`
    );
  }

  const deprecations: Deprecation[] = [];
  for (const raw of rawList) {
    const entry = coerceDeprecation(raw);
    if (entry) deprecations.push(entry);
  }
  return deprecations;
}
