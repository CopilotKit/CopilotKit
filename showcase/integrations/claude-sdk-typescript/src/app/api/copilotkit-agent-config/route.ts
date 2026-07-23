/**
 * Dedicated runtime for the Agent Config Object demo.
 *
 * Proxies to the Claude agent_server's `/agent-config` endpoint, which
 * reads the provider's `properties` (forwarded by the runtime as
 * `forwardedProps`) and composes the Claude system prompt from
 * tone / expertise / responseLength before each turn.
 *
 * The Claude agent reads `forwardedProps` directly off the AG-UI
 * `RunAgentInput`, so this runtime can register a plain HttpAgent with
 * no compatibility repacking step.
 */

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agentConfigAgent = createClaudeHttpAgent(`${AGENT_URL}/agent-config`);

const agents: Record<string, AbstractAgent> = {
  "agent-config-demo": agentConfigAgent,
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-agent-config",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse("/api/copilotkit-agent-config", error);
  }
};
