// Dedicated runtime for the Multimodal Attachments demo (Langroid).
//
// Why its own route? The backing agent (`multimodal_agent.py`) runs a
// vision-capable model (gpt-4o). Every other cell in the showcase uses a
// text-only, cheaper model. Registering this agent under the shared
// `/api/copilotkit` runtime would silently upgrade *all* cells that share
// that runtime to a vision model whenever the browser routed to this one
// — wasting tokens and blurring the per-demo cost boundary.
//
// The page at `src/app/demos/multimodal/page.tsx` points its `runtimeUrl`
// here and sets `agent="multimodal-demo"`.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const multimodalAgent = new HttpAgent({ url: `${AGENT_URL}/multimodal` });

const agents = {
  // The page mounts <CopilotKit agent="multimodal-demo">.
  "multimodal-demo": multimodalAgent,
  // useAgent() with no args defaults to "default"; alias for safety.
  default: multimodalAgent,
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
