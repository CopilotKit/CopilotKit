import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import {
  LangGraphAgent,
  LangGraphHttpAgent,
} from "@copilotkit/runtime/langgraph";

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
