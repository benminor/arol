import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Deprecated Mythos preview pinned in a real call.
export const response = client.messages.create({
  model: "claude-mythos-preview",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
