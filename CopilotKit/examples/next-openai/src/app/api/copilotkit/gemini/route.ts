import {
  CopilotRuntime,
  GoogleGenerativeAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest } from "next/server";

export const POST = async (req: NextRequest) => {
  const runtime = new CopilotRuntime();

  const genAI = new GoogleGenerativeAI(process.env["GOOGLE_API_KEY" + ""]!);
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  const serviceAdapter = new GoogleGenerativeAIAdapter({ model });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
