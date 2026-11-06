// TODO(copilotkit-2.0): `LangGraphAgent`: `@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them. https://docs.copilotkit.ai/agent-spec/langgraph
import { LangGraphAgent } from "@ag-ui/langgraph";
// TODO(copilotkit-2.0): `CopilotRuntime`: V2 uses AG-UI runtime handlers instead of the v1 GraphQL adapter setup. https://docs.copilotkit.ai/runtime-server-adapter
// TODO(copilotkit-2.0): `LangGraphHttpAgent`: `@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them. https://docs.copilotkit.ai/agent-spec/langgraph
import { CopilotRuntime } from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@ag-ui/langgraph";

export const runtime = new CopilotRuntime({
  agents: {
    graph: new LangGraphAgent({ deploymentUrl: "http://localhost:8123", graphId: "agent" }),
    http: new LangGraphHttpAgent({ url: "http://localhost:8000" }),
  },
});
