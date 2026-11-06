import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  MCPClient,
} from "@copilotkit/runtime";

const runtime = new CopilotRuntime();
const serviceAdapter = new OpenAIAdapter();

export const POST = async (req: Request) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({ runtime, serviceAdapter, endpoint: "/api/copilotkit" });
  return handleRequest(req);
};
