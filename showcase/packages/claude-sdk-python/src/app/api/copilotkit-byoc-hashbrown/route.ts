// Dedicated runtime for the byoc-hashbrown demo.
//
// The backing Python agent (see src/agent_server.py `/byoc-hashbrown`)
// has a system prompt tuned to emit the hashbrown JSON envelope
// `{ui: [{tagName: {props: {...}}}, ...]}` — see
// `src/agents/byoc_hashbrown_agent.py` for the full schema. Keeping
// that prompt off the shared `/api/copilotkit` runtime is load-bearing
// because the other demos share the sales-assistant prompt.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-hashbrown` });
}

const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": createAgent(),
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
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
