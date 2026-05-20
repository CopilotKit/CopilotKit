// Dedicated runtime for the Multimodal Attachments demo (Mastra).
//
// Why its own route? The backing Mastra agent runs a vision-capable model
// (gpt-4o). Other cells in the showcase use cheaper text-only models.
// Registering the multimodal agent under the shared `/api/copilotkit`
// runtime would silently upgrade all cells sharing that runtime to a vision
// model — wasting tokens and blurring the per-demo cost boundary. A
// dedicated route keeps the vision capability — and its cost — scoped to
// exactly the cell that exercises it, matching the pattern used by
// `/api/copilotkit-beautiful-chat`.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";

const multimodalAgent = getLocalAgent({
  mastra,
  agentId: "multimodalAgent",
  resourceId: "mastra-multimodal-demo",
});

if (!multimodalAgent) {
  throw new Error(
    "getLocalAgent returned null for multimodalAgent — required for /demos/multimodal",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "multimodal-demo": multimodalAgent,
    default: multimodalAgent,
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
