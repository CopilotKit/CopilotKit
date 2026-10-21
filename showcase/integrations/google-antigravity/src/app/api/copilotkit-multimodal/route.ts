// Dedicated runtime for the Multimodal Attachments demo.
//
// The page at src/app/demos/multimodal/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="multimodal-demo"`. Keeping the cell on its
// own route scopes the attachment-reading agent (src/agents/multimodal.py)
// to exactly the cell that exercises it, matching langgraph-python's
// `/api/copilotkit-multimodal`.
//
// The Python backend mounts the agent at `/multimodal-demo`; the adapter
// forwards the user message's inline image and document parts to Gemini as
// media.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    const headers = extractForwardedHeaders(req);
    const multimodalAgent = new HttpAgent({
      url: `${AGENT_URL}/multimodal-demo`,
      headers,
    });

    const runtime = new CopilotRuntime({
      agents: {
        // The page's <CopilotKit agent="multimodal-demo"> resolves here.
        "multimodal-demo": multimodalAgent,
        // Alias for any internal component that calls `useAgent()` without
        // args (matches the beautiful-chat route's "default" alias).
        default: multimodalAgent,
      },
    });

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-multimodal",
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
};
