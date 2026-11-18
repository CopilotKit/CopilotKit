import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { LangGraphAgent } from "@ag-ui/langgraph";
import type { NextRequest } from "next/server";

/**
 * Preview API Route
 *
 * This endpoint is used exclusively by the playground preview iframe.
 * It connects to a fixed local agent for demo purposes.
 * Users can configure different values in the UI for code export.
 */
export const POST = async (req: NextRequest) => {
  // Fixed values for preview - actual deployments use environment variables
  const agUiUrl = process.env.AGENT_URL || "http://localhost:8124";
  const agentName = "sample_agent";

  const serviceAdapter = new ExperimentalEmptyAdapter();

  const runtime = new CopilotRuntime({
    agents: {
      [agentName]: new LangGraphAgent({
        deploymentUrl: agUiUrl,
        graphId: agentName,
        langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
      }),
    },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit-preview",
  });

  return handleRequest(req);
};
