import { describe, expect, it } from "vitest";
import { collectIgnoredLines } from "../src/scanner";
import { scanTmp } from "./helpers";

/** Inline suppression: arol-ignore (same line) and arol-ignore-next-line. */

describe("collectIgnoredLines", () => {
  it("maps same-line and next-line directives to the right line numbers", () => {
    const src = [
      "const a = 1; // arol-ignore", // line 1 → ignored
      "const b = 2;", // line 2
      "// arol-ignore-next-line", // line 3
      "const c = 3;", // line 4 → ignored
      "# arol-ignore", // line 5 → ignored (python style)
    ].join("\n");
    expect([...collectIgnoredLines(src)].sort()).toEqual([1, 4, 5]);
  });
});

describe("arol-ignore suppresses matches", () => {
  it("same-line directive drops the match; other lines still fire", () => {
    const result = scanTmp({
      "src/app.ts": [
        'import OpenAI from "openai";',
        'const legacy = "text-davinci-003"; // arol-ignore',
        'const also = "text-davinci-002";',
      ].join("\n"),
    });
    const finding = result.findings.find(
      (f) => f.deprecation.id === "openai-legacy-retired-models"
    );
    expect(finding).toBeDefined();
    expect(finding!.patternMatches).toHaveLength(1);
    expect(finding!.patternMatches[0].text).toContain("text-davinci-002");
  });

  it("next-line directive drops the following line's match", () => {
    const result = scanTmp({
      "src/app.ts": [
        'import OpenAI from "openai";',
        "// arol-ignore-next-line",
        'const legacy = "text-davinci-003";',
      ].join("\n"),
    });
    expect(
      result.findings.some(
        (f) => f.deprecation.id === "openai-legacy-retired-models"
      )
    ).toBe(false);
  });

  it("suppressing every match means no finding at all", () => {
    const result = scanTmp({
      "src/app.py": [
        "import openai",
        'model = "text-davinci-003"  # arol-ignore',
      ].join("\n"),
    });
    expect(
      result.findings.some(
        (f) => f.deprecation.id === "openai-legacy-retired-models"
      )
    ).toBe(false);
  });
});
