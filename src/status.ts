import { Deprecation, Status } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight-UTC timestamp for a Date's calendar day. */
function startOfDayUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Parse an ISO `YYYY-MM-DD` sunset date to a UTC midnight timestamp.
 * Returns null for null/empty/unparseable input — callers must treat null as
 * "no usable date" and skip all date math.
 */
export function parseSunsetDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Whole calendar days from today to the sunset date: positive = in the future,
 * negative = in the past, 0 = today. Returns null when there is no usable date,
 * so the result can never be NaN.
 */
export function daysUntil(date: string | null | undefined, now: Date): number | null {
  const t = parseSunsetDate(date);
  if (t === null) return null;
  return Math.round((t - startOfDayUTC(now)) / MS_PER_DAY);
}

/**
 * The effective status for a finding. An explicit `status` is always honored;
 * otherwise it is derived from sunset_date relative to `now`:
 *   null/absent → "deprecated", past → "retired", today or future → "scheduled".
 */
export function effectiveStatus(d: Deprecation, now: Date): Status {
  if (d.status) return d.status;
  const t = parseSunsetDate(d.sunset_date);
  if (t === null) return "deprecated";
  return t < startOfDayUTC(now) ? "retired" : "scheduled";
}

/**
 * Whether a finding should fail the CI gate (non-zero exit): any high-severity
 * finding, or a scheduled finding landing within `within` days. Dateless
 * "deprecated" and non-imminent medium/low findings are warn-only.
 */
export function isActionable(d: Deprecation, now: Date, within: number): boolean {
  if (d.severity === "high") return true;
  if (effectiveStatus(d, now) !== "scheduled") return false;
  const days = daysUntil(d.sunset_date, now);
  return days !== null && days >= 0 && days <= within;
}
