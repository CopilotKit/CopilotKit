// Dedicated runtime for the declarative-json-render demo (Langroid).
//
// The demo page renders the agent's JSON output into a frontend-owned
// component catalog via @json-render/react. The agent behind this endpoint
// is the FastAPI handler at `${AGENT_URL}/byoc-json-render` (see
// `src/agents/byoc_json_render_agent.py`). The demo folder + route surface
// were renamed from `byoc-json-render` to the canonical
// `declarative-json-render`; the agent ID retains its legacy
// `byoc_json_render` name.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-json-render`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    byoc_json_render: byocJsonRenderAgent,
    default: byocJsonRenderAgent,
  },
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
