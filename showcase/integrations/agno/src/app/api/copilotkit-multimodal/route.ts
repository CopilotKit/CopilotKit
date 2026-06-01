// Dedicated runtime for the Multimodal Attachments demo (Agno).
//
// Why its own route? The backing graph (multimodal_agent) runs a vision-
// capable model (gpt-4o). Other showcase cells use cheaper text-only models;
// scoping the vision capability — and its cost — to exactly the cell that
// exercises it matches the pattern used by the LangGraph reference.
//
// The page at src/app/demos/multimodal/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="multimodal-demo"` (resolved below).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const multimodalAgent = new HttpAgent({
  url: `${AGENT_URL}/multimodal/agui`,
});

const agents = {
  "multimodal-demo": multimodalAgent,
  default: multimodalAgent,
} as const;

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
