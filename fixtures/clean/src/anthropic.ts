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

// Current Mythos model — must NOT flag the mythos-preview deprecation.
export const mythos5 = anthropic.messages.create({
  model: "claude-mythos-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});

// Claude Opus 4.8 — the migration target for retired Opus 4.1.
export const opus48 = anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});

// Claude Haiku 4.5 — the migration target for retired Haiku 3.5.
export const haiku45 = anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
