import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
  copilotKitEndpoint,
  OpenAIAdapter,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const serviceAdapter = new OpenAIAdapter({ openai } as any);

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
