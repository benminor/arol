import OpenAI from "openai";

// Legacy realtime model — scheduled for removal Jan 20, 2027.
const client = new OpenAI();

export const session = client.realtime.sessions.create({ model: "gpt-realtime" });
