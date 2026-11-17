// TODO(copilotkit-2.0): `LangGraphAgent`: It does not convert the events that the CopilotKit SDK emit helpers send (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit`), so the chat does not show them. Send the 2.0 event names, or serve a Python graph with `LangGraphAGUIAgent` and use `LangGraphHttpAgent`. https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
import { LangGraphAgent } from "@ag-ui/langgraph";
// TODO(copilotkit-2.0): `LangGraphHttpAgent`: The events that the CopilotKit SDK emit helpers send (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit`) show in the chat only when the Python server serves the graph with `LangGraphAGUIAgent`, which converts them. https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents
import { CopilotKitRuntime } from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@ag-ui/langgraph";

export const runtime = new CopilotKitRuntime({
  agents: {
    graph: new LangGraphAgent({ deploymentUrl: "http://localhost:8123", graphId: "agent" }),
    http: new LangGraphHttpAgent({ url: "http://localhost:8000" }),
  },
});
