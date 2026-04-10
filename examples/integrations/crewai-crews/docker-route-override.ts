/**
 * Docker-specific route override.
 * In Docker, the agent runs on a separate container so we need
 * to read the URL from AGENT_URL rather than hardcoding localhost.
 */
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { CrewAIAgent } from "@ag-ui/crewai";
import type { NextRequest } from "next/server";

const agentUrl = process.env.AGENT_URL || "http://localhost:8000";

const serviceAdapter = new ExperimentalEmptyAdapter();

const runtime = new CopilotRuntime({
  agents: {
    starterAgent: new CrewAIAgent({ url: `${agentUrl}/` }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
