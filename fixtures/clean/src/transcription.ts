import OpenAI from "openai";

// Current transcription model — must NOT flag.
const client = new OpenAI();

export const transcript = client.audio.transcriptions.create({ model: "gpt-transcribe" });
