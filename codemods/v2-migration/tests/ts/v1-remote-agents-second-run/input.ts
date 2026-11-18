// TODO(copilotkit-2.0): `CopilotRuntime`: The 2.0 runtime takes no `remoteEndpoints` or `actions`. Register each agent under `agents`, and make each action a tool on an agent. See the Python SDK endpoint, LangGraph Platform and Server-side actions sections: https://docs.copilotkit.ai/migrate/agents-2.0
// TODO(copilotkit-2.0): `OpenAIAdapter` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/runtime-server-adapter
// TODO(copilotkit-2.0): `copilotKitEndpoint` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/agents-2.0#python-sdk-endpoint
// TODO(copilotkit-2.0): `langGraphPlatformEndpoint` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-platform
// TODO(copilotkit-2.0): `copilotRuntimeNextJSAppRouterEndpoint` was removed in 2.0. Use `createCopilotKitRuntimeHandler` from "@copilotkit/runtime" instead. Its API is different: https://docs.copilotkit.ai/runtime-server-adapter
// TODO(copilotkit-2.0): `resolveEndpointType` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/runtime-server-adapter
// TODO(copilotkit-2.0): `TextMessageEvents` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
// TODO(copilotkit-2.0): `ToolCallEvents` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
import {
  CopilotKitRuntime,
  OpenAIAdapter,
  copilotKitEndpoint,
  langGraphPlatformEndpoint,
  copilotRuntimeNextJSAppRouterEndpoint,
  resolveEndpointType,
  type TextMessageEvents,
  type ToolCallEvents,
} from "@copilotkit/runtime";
// TODO(copilotkit-2.0): `CustomEventNames`: The enum members and their string values differ in `@ag-ui/langgraph`. https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
// TODO(copilotkit-2.0): `TextMessageEvents` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
// TODO(copilotkit-2.0): `ToolCallEvents` was removed in 2.0 and has no direct replacement. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
import {
  CustomEventNames,
} from "@ag-ui/langgraph";
import {
  type TextMessageEvents as LangGraphTextEvents,
  type ToolCallEvents as LangGraphToolEvents,
} from "@copilotkit/runtime/langgraph";

const runtime = new CopilotKitRuntime({
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
