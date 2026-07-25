import Anthropic from "@anthropic-ai/sdk";

// Fast mode for Claude Opus 4.7 was removed on Jul 24, 2026 — this now errors.
const anthropic = new Anthropic();

export const fastOpus47 = anthropic.messages.create({
  model: "claude-opus-4-7",
  speed: "fast",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
