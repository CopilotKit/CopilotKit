import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";

const openai = new OpenAI();
const serviceAdapter = new OpenAIAdapter({ openai });

const REMOTE_ACTION_URL =
  process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit";

// const REMOTE_ACTION_URL = "https://athena-sandbox-umdb.onrender.com/copilotkit";
console.log({REMOTE_ACTION_URL})

const runtime = new CopilotRuntime({
  remoteActions: [
    {
      url: REMOTE_ACTION_URL,
    },
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
