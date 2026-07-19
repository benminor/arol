import { describe, expect, it } from "vitest";
import { effectiveSeverity, isMentionOnly } from "../src/findings";
import { scanTmp } from "./helpers";

/**
 * Mention tier: a quoted model id in a file that does NOT import the entry's
 * SDK is weak evidence (marketing pages, mockups, catalogs) — reported as
 * informational, down-ranked to low, never build-breaking.
 */

// claude-sonnet-4-20250514 belongs to anthropic-claude-4-retirement, whose
// detect.sdk is ["@anthropic-ai/sdk", "anthropic"] — a gated model entry.
const MODEL = '"claude-sonnet-4-20250514"';

describe("mention tier for model matches", () => {
  it("no SDK import → mention-only, severity capped to low", () => {
    const result = scanTmp({
      // A marketing page rendering a model name — the arol-main scenario.
      "src/pricing.tsx": `export const copy = { retiring: ${MODEL} };\n`,
    });
    const finding = result.findings.find(
      (f) => f.deprecation.id === "anthropic-claude-4-retirement"
    );
    expect(finding).toBeDefined();
    expect(finding!.patternMatches[0].mention).toBe(true);
    expect(isMentionOnly(finding!)).toBe(true);
    expect(effectiveSeverity(finding!)).toBe("low");
  });

  it("with the SDK imported → full-confidence usage, base severity kept", () => {
    const result = scanTmp({
      "src/llm.ts": `import Anthropic from "@anthropic-ai/sdk";\nconst model = ${MODEL};\n`,
    });
    const finding = result.findings.find(
      (f) => f.deprecation.id === "anthropic-claude-4-retirement"
    );
    expect(finding).toBeDefined();
    expect(finding!.patternMatches[0].mention).toBeUndefined();
    expect(isMentionOnly(finding!)).toBe(false);
    expect(effectiveSeverity(finding!)).toBe("high");
  });

  it("mixed evidence (one importing file, one not) → NOT mention-only", () => {
    const result = scanTmp({
      "src/marketing.tsx": `export const m = ${MODEL};\n`,
      "src/llm.ts": `import Anthropic from "@anthropic-ai/sdk";\nconst model = ${MODEL};\n`,
    });
    const finding = result.findings.find(
      (f) => f.deprecation.id === "anthropic-claude-4-retirement"
    );
    expect(finding).toBeDefined();
    // Real usage exists somewhere → the finding stays full severity, while
    // the marketing file's match is individually flagged as a mention.
    expect(isMentionOnly(finding!)).toBe(false);
    expect(effectiveSeverity(finding!)).toBe("high");
    const byFile = Object.fromEntries(
      finding!.patternMatches.map((m) => [m.file, m.mention === true])
    );
    expect(byFile["src/marketing.tsx"]).toBe(true);
    expect(byFile["src/llm.ts"]).toBe(false);
  });

  it("python import gating works the same way", () => {
    const result = scanTmp({
      "app/llm.py": `import anthropic\nmodel = ${MODEL}\n`,
    });
    const finding = result.findings.find(
      (f) => f.deprecation.id === "anthropic-claude-4-retirement"
    );
    expect(finding).toBeDefined();
    expect(isMentionOnly(finding!)).toBe(false);
  });
});
