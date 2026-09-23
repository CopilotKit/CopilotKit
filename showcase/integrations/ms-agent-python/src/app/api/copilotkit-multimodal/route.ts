// Dedicated runtime for the Multimodal Attachments demo.
//
// Why its own route? The backing MS Agent Framework agent (mounted at
// `/multimodal` on the Python agent server) runs a vision-capable model
// (gpt-4o-mini). Every other cell in this showcase uses the shared default
// agent. Registering the multimodal agent under the main `/api/copilotkit`
// runtime would mix concerns; a dedicated route keeps the vision capability
// scoped to exactly the cell that exercises it, matching the pattern used
// by the LangGraph showcase.
//
// The page at src/app/demos/multimodal/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="multimodal-demo"` (the slug registered below).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createMultimodalAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/multimodal` });
}

const agents: Record<string, AbstractAgent> = {
  "multimodal-demo": createMultimodalAgent(),
  // Alias for any internal component that calls `useAgent()` without args.
  default: createMultimodalAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts; published CopilotRuntime's `agents`
        // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
        // plain Records. Fixed in source, pending release.
        agents,
      }),
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
