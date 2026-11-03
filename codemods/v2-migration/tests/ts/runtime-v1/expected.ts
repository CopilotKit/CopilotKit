// TODO(copilotkit-2.0): `CopilotRuntime`: V2 uses AG-UI runtime handlers instead of the v1 GraphQL adapter setup. https://docs.copilotkit.ai/runtime-server-adapter
// TODO(copilotkit-2.0): `OpenAIAdapter` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/runtime-server-adapter
// TODO(copilotkit-2.0): `copilotRuntimeNextJSAppRouterEndpoint` was removed in 2.0. Use `createCopilotRuntimeHandler` from "@copilotkit/runtime" instead. Its API is different: https://docs.copilotkit.ai/runtime-server-adapter
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
