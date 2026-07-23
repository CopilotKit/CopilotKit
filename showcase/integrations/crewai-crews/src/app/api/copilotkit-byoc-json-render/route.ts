/**
 * Dedicated runtime for the BYOC json-render demo.
 *
 * Splitting into its own endpoint keeps the `byoc_json_render` crew
 * isolated from the default multi-agent `/api/copilotkit` runtime. The
 * frontend's demo page points `<CopilotKit runtimeUrl>` here.
 *
 * Agent URL targets the dedicated `/byoc-json-render` FastAPI endpoint
 * mounted by `agent_server.py`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-json-render` });
}

const agents: Record<string, AbstractAgent> = {
  byoc_json_render: createAgent(),
  default: createAgent(),
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
