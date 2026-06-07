import { describe, expect, it } from "vitest";
import { scanTmp, fired } from "./helpers";

// A quoted model id fires anthropic-claude-4-retirement (models run regardless of
// imports, and the entry applies to every extension), so it's a clean probe for
// "did this file get scanned at all?".
const MODEL = 'const m = "claude-sonnet-4-20250514";\n';
const ID = "anthropic-claude-4-retirement";

describe("dependency / build dirs are skipped by default", () => {
  it("skips dependency and build dirs", () => {
    for (const dir of [
      "node_modules",
      "dist",
      "build",
      "out",
      "coverage",
      ".venv",
      "venv",
      "env",
      "site-packages",
      "__pycache__",
      "vendor",
      "target",
      ".next",
      ".git",
    ]) {
      const r = scanTmp({ [`${dir}/pkg/x.ts`]: MODEL });
      expect(fired(r, ID), `${dir} should be skipped by default`).toBe(false);
    }
  });

  it("still scans ordinary source files", () => {
    expect(fired(scanTmp({ "src/app.ts": MODEL }), ID)).toBe(true);
  });

  it("--include-deps opts dependency dirs back in (incl. dot-dirs)", () => {
    expect(
      fired(scanTmp({ "node_modules/pkg/x.ts": MODEL }, { includeDeps: true }), ID)
    ).toBe(true);
    expect(
      fired(scanTmp({ ".venv/lib/x.ts": MODEL }, { includeDeps: true }), ID)
    ).toBe(true);
  });
});
