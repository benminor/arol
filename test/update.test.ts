import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { loadDeprecations, loadForScan, resolveDatasetSource } from "../src/data";
import { cachedDatasetPath, cacheMetaPath } from "../src/cache";
import {
  AUTO_UPDATE_TTL_MS,
  FetchLike,
  isOffline,
  maybeAutoUpdate,
  performUpdate,
} from "../src/update";
import { DATASET_PATH } from "./helpers";

/** Every test gets its own cache dir via AROL_CACHE_DIR — no global state. */
const tmpEnv = () => ({
  AROL_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "arol-cache-")),
});

const BUNDLED_TEXT = fs.readFileSync(DATASET_PATH, "utf8");
const BUNDLED_COUNT = loadDeprecations().length;

const okFetch =
  (body: string): FetchLike =>
  async () => ({ ok: true, status: 200, text: async () => body });

const httpError =
  (status: number): FetchLike =>
  async () => ({ ok: false, status, text: async () => "" });

/** A fetch that must never run (proves the TTL/offline gates short-circuit). */
const bombFetch: FetchLike = async () => {
  throw new Error("fetch should not have been called");
};

describe("performUpdate", () => {
  it("downloads, validates, and caches the dataset + metadata", async () => {
    const env = tmpEnv();
    const result = await performUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });

    expect(result.entries).toBe(BUNDLED_COUNT);
    expect(fs.readFileSync(cachedDatasetPath(env), "utf8")).toBe(BUNDLED_TEXT);
    const meta = JSON.parse(fs.readFileSync(cacheMetaPath(env), "utf8"));
    expect(meta.entries).toBe(BUNDLED_COUNT);
    expect(Date.parse(meta.fetchedAt)).not.toBeNaN();
  });

  it("rejects invalid JSON and never touches an existing good cache", async () => {
    const env = tmpEnv();
    await performUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });

    await expect(
      performUpdate({ env, fetchImpl: okFetch("{ not json") })
    ).rejects.toThrow(/not valid JSON/);
    // The good cache survives the bad download.
    expect(fs.readFileSync(cachedDatasetPath(env), "utf8")).toBe(BUNDLED_TEXT);
  });

  it("rejects an empty/all-invalid dataset (a truncated file must not ship)", async () => {
    const env = tmpEnv();
    await expect(
      performUpdate({ env, fetchImpl: okFetch("[]") })
    ).rejects.toThrow(/no valid entries/);
    expect(fs.existsSync(cachedDatasetPath(env))).toBe(false);
  });

  it("rejects on HTTP errors", async () => {
    const env = tmpEnv();
    await expect(performUpdate({ env, fetchImpl: httpError(500) })).rejects.toThrow(
      /HTTP 500/
    );
  });
});

describe("maybeAutoUpdate (the fail-soft gate scan uses)", () => {
  it("fetches when there is no cache yet", async () => {
    const env = tmpEnv();
    const result = await maybeAutoUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });
    expect(result).toMatchObject({ refreshed: true, reason: "refreshed" });
  });

  it("skips the network entirely while the cache is fresh", async () => {
    const env = tmpEnv();
    await performUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });
    const result = await maybeAutoUpdate({ env, fetchImpl: bombFetch });
    expect(result).toMatchObject({ refreshed: false, reason: "fresh" });
  });

  it("refreshes once the cache is older than the TTL", async () => {
    const env = tmpEnv();
    await performUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });
    const stale = new Date(Date.now() + AUTO_UPDATE_TTL_MS + 60_000);
    const result = await maybeAutoUpdate({
      env,
      fetchImpl: okFetch(BUNDLED_TEXT),
      now: stale,
    });
    expect(result).toMatchObject({ refreshed: true, reason: "refreshed" });
  });

  it("respects AROL_OFFLINE without touching the network", async () => {
    const env = { ...tmpEnv(), AROL_OFFLINE: "1" };
    const result = await maybeAutoUpdate({ env, fetchImpl: bombFetch });
    expect(result).toMatchObject({ refreshed: false, reason: "offline" });
  });

  it("fails soft on network errors: no throw, existing cache intact", async () => {
    const env = tmpEnv();
    await performUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });
    const stale = new Date(Date.now() + AUTO_UPDATE_TTL_MS + 60_000);

    const result = await maybeAutoUpdate({
      env,
      fetchImpl: httpError(503),
      now: stale,
    });
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe("error");
    expect(fs.readFileSync(cachedDatasetPath(env), "utf8")).toBe(BUNDLED_TEXT);
  });
});

describe("dataset resolution for scan", () => {
  it("orders custom > cache > bundled", async () => {
    const env = tmpEnv();
    expect(resolveDatasetSource(undefined, env).origin).toBe("bundled");

    await performUpdate({ env, fetchImpl: okFetch(BUNDLED_TEXT) });
    const cached = resolveDatasetSource(undefined, env);
    expect(cached.origin).toBe("cache");
    expect(cached.fetchedAt).not.toBeNull();

    const custom = resolveDatasetSource(DATASET_PATH, env);
    expect(custom.origin).toBe("custom");
  });

  it("falls back to the bundled dataset when the cache is corrupt, with a warning", async () => {
    const env = tmpEnv();
    fs.mkdirSync(path.dirname(cachedDatasetPath(env)), { recursive: true });
    fs.writeFileSync(cachedDatasetPath(env), "{ definitely not json");

    const loaded = loadForScan(undefined, env);
    expect(loaded.source.origin).toBe("bundled");
    expect(loaded.deprecations.length).toBe(BUNDLED_COUNT);
    expect(loaded.warning).toMatch(/cached dataset was invalid/);
  });

  it("still throws for an explicit --data file that is broken", () => {
    const env = tmpEnv();
    const bad = path.join(env.AROL_CACHE_DIR, "bad.json");
    fs.writeFileSync(bad, "nope");
    expect(() => loadForScan(bad, env)).toThrow();
  });
});

describe("isOffline", () => {
  it("treats 1/true as offline and 0/false/empty/undefined as online", () => {
    expect(isOffline({ AROL_OFFLINE: "1" })).toBe(true);
    expect(isOffline({ AROL_OFFLINE: "true" })).toBe(true);
    expect(isOffline({ AROL_OFFLINE: "0" })).toBe(false);
    expect(isOffline({ AROL_OFFLINE: "false" })).toBe(false);
    expect(isOffline({ AROL_OFFLINE: "" })).toBe(false);
    expect(isOffline({})).toBe(false);
  });
});
