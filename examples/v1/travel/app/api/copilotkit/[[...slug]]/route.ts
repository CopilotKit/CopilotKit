import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
// TODO(copilotkit-2.0): `LangGraphAgent`: `@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them. https://docs.copilotkit.ai/agent-spec/langgraph
// TODO(copilotkit-2.0): `LangGraphHttpAgent`: `@ag-ui/langgraph` does not handle CopilotKit's LangGraph events (`copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, `copilotkit_exit` from the Python SDK). Check that your agent does not rely on them. https://docs.copilotkit.ai/agent-spec/langgraph
import { LangGraphAgent, LangGraphHttpAgent } from "@ag-ui/langgraph";

const langsmithApiKey = process.env.LANGSMITH_API_KEY || "";
const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL || "";

const travel = deploymentUrl
  ? new LangGraphAgent({
      deploymentUrl,
      langsmithApiKey,
      graphId: "travel",
    })
  : new LangGraphHttpAgent({
      url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
    });

const runtime = new CopilotRuntime({
  agents: { travel },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
