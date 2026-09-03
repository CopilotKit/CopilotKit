import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import {
  LangGraphAgent,
  LangGraphHttpAgent,
} from "@copilotkit/runtime/langgraph";

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
