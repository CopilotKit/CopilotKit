import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

// Initialize OpenAI and Service Adapter globally in the module
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const serviceAdapter = new OpenAIAdapter({ openai });

const runtime = new CopilotRuntime({
  // Define the remote Python backend endpoint
  // After reviewing type definitions, remoteEndpoints is correct here.
  remoteEndpoints: [
    {
      // id: "praisonai-research", // Optional ID, can be removed if causing issues
      url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
    },
  ],
  // serviceAdapter should NOT be passed to CopilotRuntime constructor directly
  // if it's being passed to copilotRuntimeNextJSAppRouterEndpoint.
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime, 
    serviceAdapter, // serviceAdapter IS correctly passed here
    endpoint: "/api/copilotkit", 
  });

  return handleRequest(req);
};

// Keep this to allow the Next.js route to run long enough
export const maxDuration = 180; // 3 minutes 