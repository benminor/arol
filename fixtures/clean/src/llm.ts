import OpenAI from "openai";

// Migration note: we removed our old beta.assistants integration and the
// openai.ChatCompletion calls long ago — both live only in this comment now.
const client = new OpenAI();

export async function ask(prompt: string) {
  return client.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "user", content: prompt }],
  });
}
