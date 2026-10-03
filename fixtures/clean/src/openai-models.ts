import OpenAI from "openai";

const client = new OpenAI();

// Migration targets — must NOT flag the Apr 2027 / TTS / cyber entries.
export const sol = client.responses.create({ model: "gpt-6-sol" });
export const speech = client.audio.speech.create({
  model: "gpt-realtime-2.1-mini",
  voice: "alloy",
  input: "hi",
});
