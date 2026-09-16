import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Current replacement for gemini-3.1-flash-live-preview.
export const flashLive = genAI.getGenerativeModel({
  model: "gemini-3.8-live",
});
