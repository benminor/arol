import OpenAI from "openai";

const client = new OpenAI();

// Shutting down Apr 1, 2027.
export const codex = client.responses.create({ model: "gpt-5.3-codex" });

// Shutting down Jan 6, 2027.
export const speech = client.audio.speech.create({
  model: "tts-1",
  voice: "alloy",
  input: "hi",
});

// Removed Oct 1, 2026.
export const cyber = client.responses.create({ model: "gpt-5.4-cyber" });
