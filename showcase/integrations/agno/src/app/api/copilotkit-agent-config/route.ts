// Dedicated runtime for the Agent Config Object demo (Agno).
//
// The page wraps <CopilotKit properties={...}>; CopilotKit forwards those
// properties as top-level keys on `RunAgentInput.forwarded_props`, which
// the Agno-side custom AGUI handler at `/agent-config/agui` reads to
// build a per-request system prompt (see
// `src/agent_server.py::_run_agent_config`).
//
// Scoped to its own endpoint so non-demo cells don't pay the cost of the
// per-request agent factory and so the request-body propagation can be
// asserted against exactly one URL.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agentConfigAgent = new HttpAgent({
  url: `${AGENT_URL}/agent-config/agui`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "agent-config-demo": agentConfigAgent,
    default: agentConfigAgent,
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
