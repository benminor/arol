import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// Fast mode remains supported on Claude Opus 4.8 — the migration target.
export const fastOpus48 = anthropic.messages.create({
  model: "claude-opus-4-8",
  speed: "fast",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});

// Claude Opus 4.7 itself is still fully available at standard speed.
export const standardOpus47 = anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
