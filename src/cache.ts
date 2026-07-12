import * as os from "os";
import * as path from "path";

/**
 * Local cache locations for the updated dataset (written by `arol-ai update`,
 * read by `scan`). Shared by data.ts and update.ts — lives in its own module
 * so neither has to import the other.
 *
 * Resolution: $AROL_CACHE_DIR (tests / power users) > $XDG_CACHE_HOME/arol >
 * ~/.cache/arol. Everything takes an env parameter for testability.
 */
export type EnvLike = Record<string, string | undefined>;

export function cacheDir(env: EnvLike = process.env): string {
  if (env.AROL_CACHE_DIR) return env.AROL_CACHE_DIR;
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "arol");
}

/** The cached dataset written by `arol-ai update`. */
export function cachedDatasetPath(env: EnvLike = process.env): string {
  return path.join(cacheDir(env), "deprecations.json");
}

/** Sidecar metadata: when/where the cached dataset was fetched. */
export function cacheMetaPath(env: EnvLike = process.env): string {
  return path.join(cacheDir(env), "meta.json");
}
