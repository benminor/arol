import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export const flashImage = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-image",
});
