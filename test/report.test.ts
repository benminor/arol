import { describe, expect, it } from "vitest";
import { scanTmp } from "./helpers";
import { DEFAULT_REPORT_URL, submitReport } from "../src/report-upload";
import type { FetchLike } from "../src/update";

/* ------------------------- inventory in results ------------------------- */

describe("scan results include the manifest inventory", () => {
  it("lists every declared dependency with version and manifest path", () => {
    const result = scanTmp({
      "package.json": JSON.stringify({
        dependencies: { openai: "^4.0.0" },
        devDependencies: { vitest: "^4.0.0" },
      }),
      "requirements.txt": "stripe==7.1.0\n",
      "src/app.ts": "const ok = 1;\n",
    });

    expect(result.dependencies).toEqual(
      expect.arrayContaining([
        { name: "openai", version: "^4.0.0", manifest: "package.json" },
        { name: "vitest", version: "^4.0.0", manifest: "package.json" },
        { name: "stripe", version: "==7.1.0", manifest: "requirements.txt" },
      ])
    );
  });

  it("is empty (not missing) when a repo has no manifests", () => {
    const result = scanTmp({ "src/app.ts": "const ok = 1;\n" });
    expect(result.dependencies).toEqual([]);
  });
});

/* ----------------------------- submitReport ----------------------------- */

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function capturingFetch(status: number, sink: Captured[]): FetchLike {
  return async (url, init) => {
    sink.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });
    return { ok: status >= 200 && status < 300, status, text: async () => "" };
  };
}

describe("submitReport", () => {
  it("POSTs the payload as JSON with bearer auth to the default endpoint", async () => {
    const sink: Captured[] = [];
    const result = await submitReport(
      { repo: "acme-api", detected: 2 },
      { token: "tok_123", fetchImpl: capturingFetch(200, sink) }
    );

    expect(result.ok).toBe(true);
    expect(sink).toHaveLength(1);
    expect(sink[0].url).toBe(DEFAULT_REPORT_URL);
    expect(sink[0].method).toBe("POST");
    expect(sink[0].headers?.authorization).toBe("Bearer tok_123");
    expect(sink[0].headers?.["content-type"]).toBe("application/json");
    expect(JSON.parse(sink[0].body ?? "{}")).toEqual({
      repo: "acme-api",
      detected: 2,
    });
  });

  it("honors a custom endpoint URL", async () => {
    const sink: Captured[] = [];
    await submitReport(
      {},
      {
        token: "t",
        url: "https://self.hosted/ingest",
        fetchImpl: capturingFetch(200, sink),
      }
    );
    expect(sink[0].url).toBe("https://self.hosted/ingest");
  });

  it("fails soft on HTTP errors — returns ok:false, never throws", async () => {
    const result = await submitReport(
      {},
      { token: "t", fetchImpl: capturingFetch(500, []) }
    );
    expect(result).toEqual({ ok: false, detail: "HTTP 500" });
  });

  it("fails soft on network errors — returns ok:false, never throws", async () => {
    const boom: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await submitReport({}, { token: "t", fetchImpl: boom });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("ECONNREFUSED");
  });
});
