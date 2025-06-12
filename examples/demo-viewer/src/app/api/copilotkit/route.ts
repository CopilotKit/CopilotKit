import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  LangGraphAgent
} from "@copilotkit/runtime";

import { NextRequest } from "next/server";

const serviceAdapter = new OpenAIAdapter();


export const POST = async (req: NextRequest) => {
  let runtime
  if (req.url.endsWith("?standard=true")) {
    runtime = new CopilotRuntime();
  }
  else if (req.url.endsWith("?langgraph=true")) {
    let deploymentUrl = process.env.LG_DEPLOYMENT_URL ?? "http://localhost:8000"
    runtime = new CopilotRuntime({
      agents: {
        "agentic_chat": new LangGraphAgent({ deploymentUrl, graphId: 'agentic_chat' }),
        "agentic_generative_ui": new LangGraphAgent({ deploymentUrl, graphId: 'agentic_generative_ui' }),
        "human_in_the_loop": new LangGraphAgent({ deploymentUrl, graphId: 'human_in_the_loop' }),
        "predictive_state_updates": new LangGraphAgent({ deploymentUrl, graphId: 'predictive_state_updates' }),
        "shared_state": new LangGraphAgent({ deploymentUrl, graphId: 'shared_state' }),
        "tool_based_generative_ui": new LangGraphAgent({ deploymentUrl, graphId: 'tool_based_generative_ui' }),
        "no_chat": new LangGraphAgent({ deploymentUrl, graphId: 'no_chat' })
      }
    });
  }
  else if (req.url.endsWith("?crewai=true")) {
    runtime = new CopilotRuntime({
      remoteEndpoints: [
        {
          url: process.env.REMOTE_ACTION_URL || process.env.REMOTE_ACTION_URL_CREWAI || "http://localhost:8000/copilotkit",
        },
      ],
    });
  }
  else{
    runtime = new CopilotRuntime({
      remoteEndpoints: [
        {
          url: process.env.REMOTE_ACTION_URL || "http://localhost:8000/copilotkit",
        },
      ],
    });
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
