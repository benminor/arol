import type { FetchLike } from "./update";

/**
 * Opt-in scan reporting for continuous monitoring (`--report <token>`).
 *
 * Privacy contract: nothing is ever sent unless the user passes a token. The
 * payload is the same data `--json` prints — findings metadata (file paths,
 * line numbers, matched identifiers) and the manifest inventory — plus a repo
 * name. Never file contents. Fail-soft like the dataset refresh: a failed
 * upload warns on stderr and never changes the scan's exit code.
 */

export const DEFAULT_REPORT_URL = "https://arol.ai/api/ingest";

const REPORT_TIMEOUT_MS = 10_000;

export interface ReportOptions {
  token: string;
  /** Override the ingest endpoint (self-hosted / testing). */
  url?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: FetchLike;
}

export interface ReportResult {
  ok: boolean;
  detail?: string;
}

export async function submitReport(
  payload: unknown,
  opts: ReportOptions
): Promise<ReportResult> {
  const url = opts.url ?? DEFAULT_REPORT_URL;
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail:
        (err as Error)?.name === "AbortError"
          ? "timeout"
          : String((err as Error)?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}
