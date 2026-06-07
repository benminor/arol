import { describe, expect, it } from "vitest";
import { scanTmp, fired } from "./helpers";

/**
 * Permanent regression guard against pattern false positives. Each case is a
 * snippet that uses the REPLACEMENT/migrated API, or a valid identifier that
 * merely shares a substring with a deprecated token. None of these should fire
 * the named entry. Most of these previously fired before word-boundary
 * hardening (see the pattern audit) — they must never regress.
 *
 * [entryId, file (its extension must be in the entry's applies_to), code]
 */
const CLEAN_SNIPPETS: Array<[string, string, string]> = [
  // Substring collisions fixed by \b hardening
  ["stripe-removed-js-methods", "a.ts", 'const sf = ts.createSourceFile("a.ts", code);'],
  ["stripe-removed-js-methods", "a.ts", "const m = createSourceMap(input);"],
  // createSource/retrieveSource are anchored to stripe. — generic factories stay clean
  ["stripe-removed-js-methods", "a.ts", "const s = pool.createSource(opts);"],
  ["stripe-removed-js-methods", "a.ts", "const x = cache.retrieveSource(key);"],
  ["langchain-legacy-imports", "a.py", "from langchain.retrievers.document_compressors import LLMChainExtractor"],
  ["clerk-redirect-to-user-profile-component", "a.tsx", "export const X = () => <RedirectToUserProfilePage />;"],
  ["openai-python-v0-syntax", "a.py", "x = openai.ChatCompletionChunk"],
  ["twilio-programmable-chat-retired", "a.ts", "const c = new IpMessagingV2Client();"],
  ["vercel-ai-sdk-v5-removed", "a.ts", "const r = new StreamingTextResponseHelper();"],
  ["twilio-notify-eol", "a.ts", "notify.v10.foo();"],

  // Replacement / migrated APIs — must never collide with the deprecated token
  ["openai-assistants-api", "a.ts", "client.responses.create({}); client.conversations.create({});"],
  ["stripe-removed-js-methods", "a.ts", "stripe.confirmCardPayment(cs); stripe.confirmCardSetup(cs);"],
  ["openai-python-v0-syntax", "a.py", "client.chat.completions.create()"],
  ["vercel-ai-sdk-v5-removed", "a.ts", 'import { useChat } from "@ai-sdk/react";'],
  ["vercel-ai-sdk-v5-removed", "a.ts", "streamText({}); generateText({});"],
  ["langchain-legacy-imports", "a.py", "from langchain_openai import ChatOpenAI"],
  ["clerk-redirect-to-user-profile-component", "a.tsx", "clerk.redirectToUserProfile();"],

  // Generic tokens resolved by dropping / namespace-anchoring
  ["twilio-notify-eol", "a.ts", 'const client = makeSlack(); client.notify("done");'],
  ["resend-audiences-deprecated", "a.ts", "jwt.audiences.includes(aud);"],
  ["resend-audiences-deprecated", "a.ts", "facebookAds.audiences.create(spec);"],
  ["stripe-sources-charges-legacy", "a.ts", "prisma.charges.create({ data });"],
  ["stripe-sources-charges-legacy", "a.ts", "const sources = doc.sources.create();"],
];

describe("pattern false-positive guard (migrated/replacement code stays clean)", () => {
  it.each(CLEAN_SNIPPETS)("%s does not fire on: %s — %s", (id, file, code) => {
    const result = scanTmp({ [`src/${file}`]: `${code}\n` });
    expect(fired(result, id)).toBe(false);
  });

  // twilio-chat is detected in sdk-mode (manifest), so a differently-named
  // package that merely shares the prefix must not fire.
  it("twilio-chat-package-eol does not fire on the twilio-chat-react package", () => {
    const result = scanTmp({
      "package.json": JSON.stringify({
        dependencies: { "twilio-chat-react": "^1.0.0" },
      }),
    });
    expect(fired(result, "twilio-chat-package-eol")).toBe(false);
  });
});
