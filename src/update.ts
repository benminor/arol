import * as fs from "fs";
import { cacheDir, cachedDatasetPath, cacheMetaPath, EnvLike } from "./cache";
import { parseDeprecations } from "./data";

/**
 * Where the latest dataset lives. Merging to main IS shipping: every `scan`
 * (or explicit `update`) pulls this file. A single constant so it can later
 * point at a CDN (e.g. data.arol.ai) without touching anything else.
 */
export const DATASET_URL =
  "https://raw.githubusercontent.com/benminor/arol/main/src/data/deprecations.json";

/** `scan` auto-refreshes at most once per day; `arol-ai update` ignores this. */
export const AUTO_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 15_000;

/** Minimal fetch shape so tests can inject a fake and never touch the network. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface UpdateOptions {
  /** Alternate dataset URL (--url). */
  url?: string;
  /** Environment (cache dir / offline flags); defaults to process.env. */
  env?: EnvLike;
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike;
}

export interface UpdateResult {
  entries: number;
  path: string;
}

/** Sidecar metadata describing the cached dataset. */
export interface CacheMeta {
  fetchedAt: string;
  url: string;
  entries: number;
}

export function readCacheMeta(env: EnvLike = process.env): CacheMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheMetaPath(env), "utf8"));
    return typeof raw?.fetchedAt === "string" ? (raw as CacheMeta) : null;
  } catch {
    return null;
  }
}

/** True when the user opted out of all network use (AROL_OFFLINE=1). */
export function isOffline(env: EnvLike = process.env): boolean {
  const v = env.AROL_OFFLINE;
  if (v === undefined || v === "") return false;
  return v !== "0" && v.toLowerCase() !== "false";
}

async function fetchText(url: string, fetchImpl: FetchLike): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "arol-ai (deprecation scanner)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching dataset`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Write via a temp file + rename so a crash can never leave a torn dataset. */
function writeAtomic(target: string, contents: string): void {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, target);
}

/**
 * Download, validate, and cache the latest dataset. Validation runs BEFORE
 * anything is written: a bad download must never replace a good cache.
 * Throws on any failure — callers decide how loud to be.
 */
export async function performUpdate(opts: UpdateOptions = {}): Promise<UpdateResult> {
  const env = opts.env ?? process.env;
  const url = opts.url ?? DATASET_URL;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);

  const body = await fetchText(url, fetchImpl);
  const entries = parseDeprecations(body, url);
  if (entries.length === 0) {
    throw new Error(`remote dataset at ${url} contains no valid entries`);
  }

  fs.mkdirSync(cacheDir(env), { recursive: true });
  writeAtomic(cachedDatasetPath(env), body);
  const meta: CacheMeta = {
    fetchedAt: new Date().toISOString(),
    url,
    entries: entries.length,
  };
  writeAtomic(cacheMetaPath(env), JSON.stringify(meta, null, 2) + "\n");
  return { entries: entries.length, path: cachedDatasetPath(env) };
}

export interface AutoUpdateResult {
  refreshed: boolean;
  reason: "refreshed" | "fresh" | "offline" | "error";
  detail?: string;
}

/**
 * The fail-soft refresh `scan` runs by default: skip when offline or when the
 * cache is younger than the TTL; otherwise try to update. NEVER throws — a
 * scan must work on a plane, behind a proxy, or in an air-gapped CI, falling
 * back to the cached/bundled dataset.
 */
export async function maybeAutoUpdate(
  opts: UpdateOptions & { now?: Date } = {}
): Promise<AutoUpdateResult> {
  const env = opts.env ?? process.env;
  if (isOffline(env)) return { refreshed: false, reason: "offline" };

  const meta = readCacheMeta(env);
  const now = opts.now ?? new Date();
  if (meta) {
    const age = now.getTime() - Date.parse(meta.fetchedAt);
    if (Number.isFinite(age) && age >= 0 && age < AUTO_UPDATE_TTL_MS) {
      return { refreshed: false, reason: "fresh" };
    }
  }

  try {
    await performUpdate(opts);
    return { refreshed: true, reason: "refreshed" };
  } catch (err) {
    return { refreshed: false, reason: "error", detail: (err as Error).message };
  }
}
