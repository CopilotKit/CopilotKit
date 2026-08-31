// Dedicated runtime for the Multimodal demo.
//
// The underlying agent is vision-capable (gpt-4o). Keeping it on its own
// runtime keeps the cost of the vision model isolated to the one demo that
// exercises it.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const multimodalAgent = new HttpAgent({
  url: `${AGENT_URL}/multimodal/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "multimodal-demo": multimodalAgent as AbstractAgent,
    default: multimodalAgent as AbstractAgent,
  },
});

export const POST = async (req: NextRequest) => {
  try {
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
