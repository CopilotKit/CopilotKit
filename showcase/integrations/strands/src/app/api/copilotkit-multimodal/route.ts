// Dedicated runtime for the Multimodal Attachments demo (Strands).
//
// Mirrors the LangGraph-Python shape: the multimodal cell gets its own
// runtime so vision-capable model settings stay scoped to that one cell.
// Strands shares the root agent until B6 adds a dedicated /multimodal/ mount.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

const multimodalAgent = new HttpAgent({ url: `${AGENT_URL}/` });
const agents = {
  "multimodal-demo": multimodalAgent,
  default: multimodalAgent,
};

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-multimodal/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-multimodal/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-multimodal/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
