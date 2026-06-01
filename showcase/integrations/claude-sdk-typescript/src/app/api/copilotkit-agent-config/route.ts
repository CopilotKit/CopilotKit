/**
 * Dedicated runtime for the Agent Config Object demo.
 *
 * Proxies to the Claude agent_server's `/agent-config` endpoint, which
 * reads the provider's `properties` (forwarded by the runtime as
 * `forwardedProps`) and composes the Claude system prompt from
 * tone / expertise / responseLength before each turn.
 *
 * Unlike the LangGraph reference, the Claude agent reads
 * `forwardedProps` directly off the AG-UI `RunAgentInput` — there is no
 * `RunnableConfig.configurable.properties` plumbing to bridge because
 * the pass-through doesn't use LangGraph's config protocol. So this
 * runtime can register a plain HttpAgent with no subclass.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agentConfigAgent = new HttpAgent({ url: `${AGENT_URL}/agent-config` });

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
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
