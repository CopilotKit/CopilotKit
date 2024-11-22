import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const serviceAdapter = new OpenAIAdapter({ openai });
const runtime = new CopilotRuntime({
  remoteActions: [
    {
      url:
        process.env.REMOTE_ACTION_URL ||
        "http://localhost:8000/copilotkit_remote",
    },
  ],
});

const endpoint = "/api/copilotkit";

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint,
  });

  return handleRequest(req);
};
