import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { scanRepo } from "../src/scanner";
import { loadDeprecations } from "../src/data";
import { fired } from "./helpers";
import { Deprecation, ScanResult } from "../src/types";

function scanWith(deps: Deprecation[], files: Record<string, string>): ScanResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arol-gate-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return scanRepo(dir, deps);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A gated entry on sdk:["ai"] with common-looking tokens (the scenario the
// feature exists for). Cast bypasses the loader; detect arrays are explicit.
const AI = [
  {
    id: "test-ai",
    vendor: "T",
    title: "t",
    severity: "low",
    match: "pattern",
    applies_to: ["*"],
    sunset_date: null,
    migration_url: "",
    summary: "",
    detect: {
      sdk: ["ai"],
      patterns: [
        "\\bCoreMessage\\b",
        "\\bgenerateObject\\b",
        "\\bAgent\\b",
        "\\bMockLanguageModelV1\\b",
      ],
      models: [],
    },
  },
] as unknown as Deprecation[];

const aiFires = (code: string) => fired(scanWith(AI, { "src/a.ts": code + "\n" }), "test-ai");

// A gated Python entry on sdk:["openai"].
const OPENAI_PY = [
  {
    id: "test-openai-py",
    vendor: "T",
    title: "t",
    severity: "low",
    match: "pattern",
    applies_to: ["py"],
    sunset_date: null,
    migration_url: "",
    summary: "",
    detect: { sdk: ["openai"], patterns: ["\\bChatCompletion\\b"], models: [] },
  },
] as unknown as Deprecation[];

const pyFires = (code: string) =>
  fired(scanWith(OPENAI_PY, { "app.py": code + "\n" }), "test-openai-py");

describe("import-gating — must FIRE (package imported)", () => {
  it("ES named import", () => {
    expect(aiFires('import { CoreMessage } from "ai";\nconst m: CoreMessage = x;')).toBe(true);
  });
  it("aliased import fires at least on the import line", () => {
    expect(aiFires('import { Agent as MyAgent } from "ai";\nconst a = new MyAgent();')).toBe(true);
  });
  it("namespace import + namespaced usage", () => {
    expect(aiFires('import * as ai from "ai";\nconst x = ai.generateObject({});')).toBe(true);
  });
  it("default + named import", () => {
    expect(aiFires('import D, { CoreMessage } from "ai";\nuse(D);')).toBe(true);
  });
  it("CJS require destructure", () => {
    expect(aiFires('const { CoreMessage } = require("ai");')).toBe(true);
  });
  it("subpath import (ai/test) gated by sdk:['ai']", () => {
    expect(aiFires('import { MockLanguageModelV1 } from "ai/test";\nnew MockLanguageModelV1();')).toBe(true);
  });
  it("type-only import (import type)", () => {
    expect(aiFires('import type { CoreMessage } from "ai";\nlet m: CoreMessage;')).toBe(true);
  });
  it("inline type import (import { type X })", () => {
    expect(aiFires('import { type CoreMessage } from "ai";\nlet m: CoreMessage;')).toBe(true);
  });
  it("dynamic import()", () => {
    expect(aiFires('const mod = await import("ai");\nconst x = CoreMessage;')).toBe(true);
  });
  it("Python: import openai", () => {
    expect(pyFires("import openai\nopenai.ChatCompletion.create()")).toBe(true);
  });
  it("Python: from openai import X", () => {
    expect(pyFires("from openai import ChatCompletion\nChatCompletion.create()")).toBe(true);
  });
});

describe("import-gating — must NOT fire (the core win)", () => {
  it("token used but nothing imported from the package", () => {
    expect(aiFires("const m: CoreMessage = x;")).toBe(false);
  });
  it("same-prefix different package (aimee) does not satisfy sdk:['ai']", () => {
    expect(aiFires('import { x } from "aimee";\nconst m: CoreMessage = x;')).toBe(false);
  });
  it("hyphen-prefix different package (ai-utils) does not satisfy sdk:['ai']", () => {
    expect(aiFires('import { x } from "ai-utils";\nconst a = new Agent();')).toBe(false);
  });
  it("token only inside a comment (even when the package is imported)", () => {
    expect(aiFires('import { foo } from "ai";\n// CoreMessage is deprecated\nconst ok = 1;')).toBe(false);
  });
  it("token as an object key in a non-importing file", () => {
    expect(aiFires("const cfg = { CoreMessage: 1 };")).toBe(false);
  });
  it("Python: token without importing openai", () => {
    expect(pyFires("ChatCompletion.create()")).toBe(false);
  });
});

// Regression guard: each REAL sdk-tagged pattern entry still fires when its
// package is imported and a deprecated token is used. Scanned with the real dataset.
const GATED_FIXTURES: Array<[id: string, file: string, code: string]> = [
  ["stripe-removed-js-methods", "a.ts", 'import Stripe from "stripe";\nstripe.createSource(el);'],
  ["stripe-sources-charges-legacy", "a.ts", 'import Stripe from "stripe";\nstripe.charges.create({});'],
  ["twilio-notify-eol", "a.ts", 'import twilio from "twilio";\nclient.notify.v1.services(sid);'],
  ["twilio-programmable-chat-retired", "a.ts", 'import twilio from "twilio";\nclient.chat.v2.services(sid);'],
  ["openai-python-v0-syntax", "app.py", "import openai\nopenai.ChatCompletion.create()"],
  ["vercel-ai-sdk-v5-removed", "a.ts", 'import { StreamingTextResponse } from "ai";\nnew StreamingTextResponse(s);'],
  ["langchain-legacy-imports", "app.py", "from langchain.llms import OpenAI"],
  ["resend-audiences-deprecated", "a.ts", 'import { Resend } from "resend";\nresend.audiences.create({});'],
  ["clerk-redirect-to-user-profile-component", "a.tsx", 'import { RedirectToUserProfile } from "@clerk/nextjs";\nconst X = RedirectToUserProfile;'],
];

// The two intentionally-UNGATED entries: distinctive URL params / REST paths
// must still fire with NO package import (raw HTTP usage).
const UNGATED_FIXTURES: Array<[id: string, file: string, code: string]> = [
  ["openai-assistants-api", "a.ts", 'await fetch("https://api.openai.com/v1/threads");'],
  ["hubspot-api-key-hapikey", "a.ts", 'const u = "https://api.hubapi.com/x?hapikey=" + key;'],
];

// Gated entries must NOT fire when the package is not imported (the win, on real data).
const GATED_NEGATIVES: Array<[id: string, file: string, code: string]> = [
  ["vercel-ai-sdk-v5-removed", "a.ts", "const r = new StreamingTextResponse(s);"],
  ["resend-audiences-deprecated", "a.ts", "resend.audiences.create({});"],
  ["clerk-redirect-to-user-profile-component", "a.tsx", "const X = RedirectToUserProfile;"],
];

describe("import-gating — regression over the real dataset", () => {
  const real = loadDeprecations();
  const run = (file: string, code: string, id: string) =>
    fired(scanWith(real, { [file]: code + "\n" }), id);

  it.each(GATED_FIXTURES)("%s fires when its package is imported", (id, file, code) => {
    expect(run(file, code, id)).toBe(true);
  });

  it.each(UNGATED_FIXTURES)("%s (ungated) fires with no import", (id, file, code) => {
    expect(run(file, code, id)).toBe(true);
  });

  it.each(GATED_NEGATIVES)("%s does NOT fire without its import", (id, file, code) => {
    expect(run(file, code, id)).toBe(false);
  });
});
