import { CopilotRuntime, GoogleGenerativeAIAdapter } from "@copilotkit/backend";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  const copilotKit = new CopilotRuntime();
  const apiKey = process.env["GOOGLE_API_KEY"]!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  return copilotKit.response(req, new GoogleGenerativeAIAdapter({ model }));
}
