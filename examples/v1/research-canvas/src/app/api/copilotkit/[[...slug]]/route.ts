import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
// TODO(copilotkit-2.0): `LangGraphAgent`: `@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them. https://docs.copilotkit.ai/agent-spec/langgraph
// TODO(copilotkit-2.0): `LangGraphHttpAgent`: `@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them. https://docs.copilotkit.ai/agent-spec/langgraph
import { LangGraphAgent, LangGraphHttpAgent } from "@ag-ui/langgraph";

const runtime = new CopilotRuntime({
  agents: () => {
    const deploymentUrl = process.env.LGC_DEPLOYMENT_URL;

    if (deploymentUrl) {
      return {
        research_agent: new LangGraphAgent({
          deploymentUrl,
          langsmithApiKey: process.env.LANGSMITH_API_KEY,
          graphId: "research_agent",
        }),
      };
    }

    const baseUrl =
      process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit";

    return {
      research_agent: new LangGraphHttpAgent({
        url: `${baseUrl}/agents/research_agent`,
      }),
    };
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
