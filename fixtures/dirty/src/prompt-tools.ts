// Anthropic experimental prompt tools — retired with the Workbench (fixture).
const BASE = "https://api.anthropic.com";

export async function generatePrompt(task: string) {
  return fetch(`${BASE}/v1/experimental/generate_prompt`, { method: "POST" });
}

export async function improvePrompt(prompt: string) {
  return fetch(`${BASE}/v1/experimental/improve_prompt`, { method: "POST" });
}

export async function templatizePrompt(prompt: string) {
  return fetch(`${BASE}/v1/experimental/templatize_prompt`, { method: "POST" });
}
