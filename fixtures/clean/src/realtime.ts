import OpenAI from "openai";

// Current realtime model — must NOT flag.
const client = new OpenAI();

export const session = client.realtime.sessions.create({ model: "gpt-realtime-2.1" });
