// Dedicated runtime for the Multimodal Attachments demo.
//
// The demo page (`src/app/demos/multimodal/page.tsx`) wires CopilotChat's
// attachment config for image + PDF uploads and dispatches sample files via
// `agent.addMessage` + `copilotkit.runAgent`. Hermes serves every run from a
// single AG-UI endpoint, so this proxies to the same HttpAgent as the main
// route; only the runtime endpoint + registered agent name
// (`multimodal-demo`) differ. Matching langgraph-python's dedicated
// `/api/copilotkit-multimodal` route boundary (there the dedicated route
// scoped a vision model; here it keeps the per-demo boundary consistent).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HermesAgent } from "@ag-ui/hermes";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "multimodal-demo": new HermesAgent({ url: `${AGENT_URL}/` }),
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
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
