// Dedicated runtime for the byoc-json-render demo (Mastra).
//
// The demo page renders streaming JSON from the agent into a frontend-owned
// component catalog. In the langgraph-python integration, a dedicated
// `byoc_json_render` LangGraph graph emits the JSON envelope; for the
// Mastra port we reuse the shared weatherAgent — the dashboard shape is
// enforced entirely on the frontend by the catalog and the renderer.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

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

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const copilotHandler = createCopilotRuntimeHandler({
        runtime,
        basePath: "/api/copilotkit-byoc-json-render",
        mode: "single-route",
      });
      return await copilotHandler(req);
    } catch (error: unknown) {
      const e = error as { message?: string; stack?: string };
      return NextResponse.json(
        { error: e.message, stack: e.stack },
        { status: 500 },
      );
    }
  });
