import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Current replacement for Gemini 2.5 Flash Image ("Nano Banana").
export const flashImage = genAI.getGenerativeModel({
  model: "gemini-3.1-flash-image",
});
