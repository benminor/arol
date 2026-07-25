import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Current Mythos model — must NOT flag the mythos-preview deprecation.
export const response = client.messages.create({
  model: "claude-mythos-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hi" }],
});
