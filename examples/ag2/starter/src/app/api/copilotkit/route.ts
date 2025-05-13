import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

import { NextRequest } from "next/server";

export const POST = async (req: NextRequest) => {
  const AGENTIC_CHAT_AGENT_URL = process.env.AGENTIC_CHAT_AGENT_URL;

  const ag2Agent = new HttpAgent({
    url: AGENTIC_CHAT_AGENT_URL!,
  });

  const runtime = new CopilotRuntime({
    agents: { ag2Agent },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  // Use the original request for handleRequest
  return handleRequest(req);
};
