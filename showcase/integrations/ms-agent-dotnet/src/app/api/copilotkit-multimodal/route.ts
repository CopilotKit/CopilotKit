// Dedicated runtime for the Multimodal Attachments demo.
//
// Why its own route? The backing agent (MultimodalAgent, mounted at
// `/multimodal` by the .NET backend) is the only one in this showcase that
// expects vision content parts. Registering it under the shared
// `/api/copilotkit` runtime would silently route every other cell through the
// vision endpoint too. A dedicated route keeps the vision capability scoped
// to exactly the cell that exercises it, matching the LangGraph reference's
// pattern for `/api/copilotkit-multimodal`.
//
// The page at src/app/demos/multimodal/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="multimodal-demo"`.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  // Points at the `/multimodal` mount on the .NET backend (Program.cs:
  // `app.MapAGUI("/multimodal", ...)`).
  return new HttpAgent({ url: `${AGENT_URL}/multimodal` });
}

const agents: Record<string, AbstractAgent> = {
  "multimodal-demo": createAgent(),
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
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
