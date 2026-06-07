import { describe, expect, it } from "vitest";
import { scanTmp, fired } from "./helpers";
import { modelRegexSource } from "../src/scanner";

describe("matching engine — regression per fixed false-positive class", () => {
  it("language scoping: openai.ChatCompletion fires in .py but not .tsx", () => {
    const tsx = scanTmp({
      "src/a.tsx": "const x = openai.ChatCompletion.create();\n",
    });
    expect(tsx.findings).toHaveLength(0);

    const py = scanTmp({
      // openai-python-v0-syntax is import-gated; the file must import openai.
      "legacy.py": "import openai\nresp = openai.ChatCompletion.create()\n",
    });
    expect(py.findings).toHaveLength(1);
    expect(fired(py, "openai-python-v0-syntax")).toBe(true);
  });

  it("model exactness: gpt-4o + ISO snapshot match; gpt-4o-mini / unquoted do not", () => {
    // Tests the model-regex builder directly (gpt-4o is not itself in the
    // dataset — it isn't deprecated — but the false-positive class is the regex).
    const hits = (s: string) => new RegExp(modelRegexSource("gpt-4o")).test(s);
    expect(hits('"gpt-4o"')).toBe(true);
    expect(hits("'gpt-4o'")).toBe(true);
    expect(hits('"gpt-4o-2024-05-13"')).toBe(true);
    expect(hits('"gpt-4o-mini"')).toBe(false);
    expect(hits('"gpt-4o-realtime-preview"')).toBe(false);
    expect(hits("gpt-4o")).toBe(false); // unquoted prose never matches
  });

  it("model literals only: quoted model matches; unquoted JSX prose does not", () => {
    const id = "anthropic-claude-4-retirement";
    const quoted = scanTmp({
      "src/a.ts": 'const m = { model: "claude-sonnet-4-20250514" };\n',
    });
    expect(fired(quoted, id)).toBe(true);

    const prose = scanTmp({
      "src/Note.tsx":
        "export const N = () => <p>We use claude-sonnet-4-20250514 here.</p>;\n",
    });
    expect(prose.findings).toHaveLength(0);
  });

  it("comment stripping: a pattern inside // or # comments does not fire", () => {
    const slash = scanTmp({
      "src/a.ts": "// migrated off beta.assistants last quarter\nconst ok = 1;\n",
    });
    expect(slash.findings).toHaveLength(0);

    const hash = scanTmp({
      "legacy.py": "# old: openai.ChatCompletion.create()\nok = 1\n",
    });
    expect(hash.findings).toHaveLength(0);
  });

  it("param tightening: hapikey= matches; bare 'hapikey' in prose does not", () => {
    const id = "hubspot-api-key-hapikey";
    const used = scanTmp({
      "src/a.ts": 'const u = "https://api.hubapi.com/x?hapikey=" + key;\n',
    });
    expect(fired(used, id)).toBe(true);

    const prose = scanTmp({
      "src/a.ts": 'const note = "the hapikey is a legacy auth concept";\n',
    });
    expect(fired(prose, id)).toBe(false);
  });

  it(".arolignore: a file matching an ignore glob is skipped", () => {
    const files = { "src/ignored.ts": 'const m = "text-davinci-003";\n' };
    // Control: without an ignore it fires.
    expect(fired(scanTmp(files), "openai-legacy-retired-models")).toBe(true);
    // With .arolignore the file is skipped entirely.
    const ignored = scanTmp({ ...files, ".arolignore": "src/ignored.ts\n" });
    expect(ignored.findings).toHaveLength(0);
  });

  it("sdk match mode: aws-sdk in package.json fires; absent does not", () => {
    const present = scanTmp({
      "package.json": JSON.stringify({ dependencies: { "aws-sdk": "^2.1000.0" } }),
    });
    expect(fired(present, "aws-sdk-js-v2-eol")).toBe(true);

    const absent = scanTmp({
      "package.json": JSON.stringify({ dependencies: { axios: "^1.7.0" } }),
    });
    expect(fired(absent, "aws-sdk-js-v2-eol")).toBe(false);
  });

  it("sdk match mode: the twilio-chat package fires its EOL entry", () => {
    const present = scanTmp({
      "package.json": JSON.stringify({ dependencies: { "twilio-chat": "^4.0.0" } }),
    });
    expect(fired(present, "twilio-chat-package-eol")).toBe(true);
  });

  it("stripe createSource fires on the stripe instance, not generic factories", () => {
    const id = "stripe-removed-js-methods";
    // stripe-removed-js-methods is import-gated; the file must import stripe.
    const imp = 'import Stripe from "stripe";\n';
    expect(fired(scanTmp({ "src/a.ts": imp + "stripe.createSource(el, data);" }), id)).toBe(true);
    expect(fired(scanTmp({ "src/a.ts": imp + "stripe.retrieveSource({ id });" }), id)).toBe(true);
    // Generic factory in an importing file still must not match (anchored to stripe.).
    expect(fired(scanTmp({ "src/a.ts": imp + "const s = pool.createSource(opts);" }), id)).toBe(false);
  });

  it("evidence: a match reports the correct file path and line number", () => {
    const result = scanTmp({
      "src/deep/client.ts": '\n\nconst m = "text-davinci-003";\n',
    });
    const finding = result.findings.find(
      (f) => f.deprecation.id === "openai-legacy-retired-models"
    );
    expect(finding).toBeDefined();
    expect(finding!.patternMatches).toHaveLength(1);
    expect(finding!.patternMatches[0].file).toBe("src/deep/client.ts");
    expect(finding!.patternMatches[0].line).toBe(3);
  });
});
