// Dedicated runtime for the Multimodal Attachments demo.
//
// Mirrors the LangGraph-Python shape: the multimodal cell gets its own
// runtime so vision-capable model settings stay scoped to that one cell.
// In the Strands showcase the backend is a single shared Strands agent
// (served by agent_server.py on port 8000); this route just registers the
// demo's slug against the same HttpAgent proxy as the main route.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const multimodalAgent = createAgent();
const agents = {
  "multimodal-demo": multimodalAgent,
  default: multimodalAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
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
