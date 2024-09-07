import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit-alt/runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest } from "next/server";

const env = process.env;

export const POST = async (req: NextRequest) => {
  const runtime = new CopilotRuntime();

  const genAI = new GoogleGenerativeAI(env["GOOGLE_API_KEY"]!);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  const serviceAdapter = new GoogleGenerativeAIAdapter({ model });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
