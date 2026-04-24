// Dedicated runtime for the Agent Config Object demo.
//
// Scoped to its own endpoint so non-demo cells don't pay the cost of this
// agent's properties plumbing and so the Playwright spec can assert
// request-body propagation against exactly one URL.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agentConfigAgent = new HttpAgent({
  url: `${AGENT_URL}/agent-config/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "agent-config-demo": agentConfigAgent as AbstractAgent,
    default: agentConfigAgent as AbstractAgent,
  },
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
