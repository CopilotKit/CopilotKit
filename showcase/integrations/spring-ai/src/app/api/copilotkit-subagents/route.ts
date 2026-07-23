// Dedicated runtime for the Sub-Agents demo.
//
// Routes to the Spring `/subagents/run` endpoint, which runs a per-request
// supervisor agent that delegates to research / writing / critique
// sub-agents (each its own ChatClient call) and emits STATE_SNAPSHOT events
// after every delegation so the live "delegation log" panel updates.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/subagents/run` });
}

const subagentsAgent = createAgent();
const agents: Record<string, AbstractAgent> = {
  subagents: subagentsAgent,
  default: subagentsAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-subagents",
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
