// Dedicated runtime for the Multimodal Attachments demo.
//
// The page at src/app/demos/multimodal/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="multimodal-demo"` — same slug LP uses, kept
// verbatim to preserve the 1:1 frontend port. The slug maps to the ADK
// `multimodal` agent mounted by agent_server.py at AGENT_URL/multimodal
// (see src/agents/registry.py).
//
// Mirrors langgraph-python's /api/copilotkit-multimodal route, adapted to
// ADK's HttpAgent + AGENT_URL backend pattern (see copilotkit-byoc-hashbrown
// for the same pattern).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Build per-request so inbound `x-aimock-context` is conveyed to the
// Python agent_server. See `src/lib/header-forwarding.ts`.
export const POST = async (req: NextRequest) => {
  try {
    const headers = extractForwardedHeaders(req);
    const multimodalAgent = new HttpAgent({
      url: `${AGENT_URL}/multimodal`,
      headers,
    });

    const runtime = new CopilotRuntime({
      agents: {
        // The page's <CopilotKit agent="multimodal-demo"> resolves here.
        "multimodal-demo": multimodalAgent,
        // Alias for any internal component that calls `useAgent()` without args
        // (matches the beautiful-chat / langgraph-python pattern).
        default: multimodalAgent,
      },
    });

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
