import { MastraClient } from "@mastra/client-js";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { NextRequest } from "next/server";

export const POST = async (req: NextRequest) => {
  // Clone the request before reading the body
  const clonedReq = req.clone();
  const body = await clonedReq.json();
  const resourceId = body.resourceId || "TEST";

  const baseUrl = process.env.MASTRA_BASE_URL || "http://localhost:4111";

  const mastra = new MastraClient({
    baseUrl,
  });

  const mastraAgents = await mastra.getAGUI({
    resourceId,
  });

  const runtime = new CopilotRuntime({
    agents: mastraAgents,
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  // Use the original request for handleRequest
  return handleRequest(req);
};
