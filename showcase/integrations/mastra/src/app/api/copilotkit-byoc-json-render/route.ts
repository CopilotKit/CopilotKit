// Dedicated runtime for the byoc-json-render demo (Mastra).
//
// The demo page renders streaming JSON from the agent into a frontend-owned
// component catalog. In the langgraph-python integration, a dedicated
// `byoc_json_render` LangGraph graph emits the JSON envelope; for the
// Mastra port we reuse the shared weatherAgent — the dashboard shape is
// enforced entirely on the frontend by the catalog and the renderer.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";

const byocJsonRenderAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-byoc-json-render",
});

if (!byocJsonRenderAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/byoc-json-render",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { byoc_json_render: byocJsonRenderAgent },
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
