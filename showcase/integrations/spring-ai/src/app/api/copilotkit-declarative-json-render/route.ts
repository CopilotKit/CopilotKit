// Dedicated runtime for the declarative-json-render demo (Spring AI).
//
// The demo page renders the agent's JSON output into a frontend-owned
// component catalog via @json-render/react. The Spring AI backend runs a
// dedicated controller at /byoc-json-render/run whose system prompt instructs
// the LLM to emit a flat-spec JSON object matching the catalog's schema. The
// demo folder + route surface were renamed from `byoc-json-render` to the
// canonical `declarative-json-render`; the agent ID retains its legacy
// `byoc_json_render` name.

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
  // @ts-expect-error -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-json-render",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-declarative-json-render/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
