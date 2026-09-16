import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export const flashLive = genAI.getGenerativeModel({
  model: "gemini-3.1-flash-live-preview",
});
