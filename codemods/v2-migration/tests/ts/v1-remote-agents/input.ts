import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotKitEndpoint,
  langGraphPlatformEndpoint,
  copilotRuntimeNextJSAppRouterEndpoint,
  resolveEndpointType,
  type TextMessageEvents,
  type ToolCallEvents,
} from "@copilotkit/runtime";
import {
  CustomEventNames,
  type TextMessageEvents as LangGraphTextEvents,
  type ToolCallEvents as LangGraphToolEvents,
} from "@copilotkit/runtime/langgraph";

const runtime = new CopilotRuntime({
  remoteEndpoints: [
    copilotKitEndpoint({ url: "http://localhost:8000/copilotkit" }),
    langGraphPlatformEndpoint({
      deploymentUrl: "http://localhost:8123",
      agents: [{ name: "agent", description: "Answers questions" }],
    }),
  ],
  actions: [{ name: "lookup", handler: async () => "ok" }],
});
const serviceAdapter = new OpenAIAdapter();

export const POST = async (req: Request) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({ runtime, serviceAdapter, endpoint: "/api/copilotkit" });
  return handleRequest(req);
};
