// Dedicated runtime for the BYOC json-render demo (Spring AI).
//
// The demo page renders the agent's JSON output into a frontend-owned
// component catalog via @json-render/react. The Spring AI backend runs a
// dedicated controller at /byoc-json-render/run whose system prompt instructs
// the LLM to emit a flat-spec JSON object matching the catalog's schema.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-json-render/run` });
}

const byocJsonRenderAgent = createAgent();
const agents: Record<string, AbstractAgent> = {
  byoc_json_render: byocJsonRenderAgent,
  default: byocJsonRenderAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-json-render",
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
