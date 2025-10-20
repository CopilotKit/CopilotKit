import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  copilotKitEndpoint,
  ExperimentalEmptyAdapter,
  // OpenAIAdapter, // Uncomment for an AI service adapter (OpenAI, Anthropic, Google AI, etc.)
} from "@copilotkit/runtime";
// import OpenAI from "openai"; // Uncomment for OpenAI

// Using ExperimentalEmptyAdapter since the Python agent backend handles all AI.
// Note: Copilot Suggestions require an AI service adapter. To enable them, use OpenAIAdapter or equivalent:
// const serviceAdapter = new OpenAIAdapter({ openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) });
const serviceAdapter = new ExperimentalEmptyAdapter();

const baseUrl = process.env.REMOTE_ACTION_URL || "http://localhost:8020/copilotkit";

const runtime = new CopilotRuntime({
  remoteEndpoints: [
    copilotKitEndpoint({
      url: baseUrl,
    }),
  ],
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
