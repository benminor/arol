import OpenAI from "openai";

// Legacy transcription model — scheduled for removal Feb 26, 2027.
const client = new OpenAI();

export const transcript = client.audio.transcriptions.create({ model: "whisper-1" });
