/**
 * Docker-specific route override.
 * Uses HttpAgent to connect to the Strands AG-UI agent served
 * as a sibling container (see docker-compose.test.yml).
 */
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import type { NextRequest } from "next/server";

const agentUrl = process.env.AGENT_URL || "http://localhost:8123";

const defaultAgent = new HttpAgent({
  url: `${agentUrl}/`,
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime: new CopilotRuntime({
      agents: { default: defaultAgent },
    }),
  });

  return handleRequest(req);
};
