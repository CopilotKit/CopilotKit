// Dedicated runtime for the declarative-json-render demo (Strands).
//
// The demo page renders the agent's JSON output into a frontend-owned
// component catalog via @json-render/react. Backend mounts a dedicated
// agent at `/byoc-json-render/` (src/agents/byoc_json_render.py). The demo
// folder + route surface were renamed from `byoc-json-render` to the
// canonical `declarative-json-render`; the agent ID retains its legacy
// `byoc_json_render` name.

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

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-json-render/` });
}

const byocJsonRenderAgent = createAgent();
const agents = {
  byoc_json_render: byocJsonRenderAgent,
  default: byocJsonRenderAgent,
};

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-declarative-json-render/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-json-render",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-expect-error -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-declarative-json-render/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-declarative-json-render/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-declarative-json-render/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
