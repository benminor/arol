import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Prompt drafting now goes through the standard Messages API — the
// experimental prompt tools endpoints are retired and had no successor.
export async function draftPrompt(task: string) {
  return client.messages.create({
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: `Write a prompt for: ${task}` }],
  });
}
