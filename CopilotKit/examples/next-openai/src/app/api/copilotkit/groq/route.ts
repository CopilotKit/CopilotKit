import {
  CopilotRuntime,
  OpenAIAdapter,
  GroqAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] });

export const POST = async (req: NextRequest) => {
  const runtime = new CopilotRuntime({});
  const serviceAdapter = new GroqAdapter({ groq });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: req.nextUrl.pathname,
  });

  return handleRequest(req);
};
