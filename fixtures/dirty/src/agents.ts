import OpenAI from "openai";

const client = new OpenAI();

// Deprecated: the Assistants beta is being removed.
export const assistant = client.beta.assistants.create({ model: "gpt-5" });

// Retired model id pinned in a real call.
export const legacyModel = "text-davinci-003";
