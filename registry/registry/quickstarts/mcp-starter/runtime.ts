import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";
import { HttpStreamClient } from "@/registry/quickstarts/mcp-starter/utils/http-stream-client";

const serviceAdapter = new OpenAIAdapter();
const runtime = new CopilotRuntime({
  createMCPClient: async (config) => {
    const mcpClient = new HttpStreamClient({
      serverUrl: config.endpoint,
    });

    await mcpClient.connect();
    return mcpClient;
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
