// Dedicated runtime for the Declarative Generative UI (A2UI fixed-schema) demo.
//
// Backend: AGENT_URL/a2ui-fixed-schema/ (already mounted). Owns display_flight
// which emits its own a2ui_operations envelope; runtime must NOT inject
// generate_a2ui (injectA2UITool: false).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
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
  return new HttpAgent({ url: `${AGENT_URL}/a2ui-fixed-schema/` });
}

const a2uiFixedAgent = createAgent();
const agents = {
  "a2ui-fixed-schema": a2uiFixedAgent,
  default: a2uiFixedAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  // Enable the A2UIMiddleware so it detects the `a2ui_operations`
  // envelope the dedicated backend agent's `display_flight` tool returns.
  // injectA2UITool: false — agent emits the envelope itself.
  a2ui: {
    injectA2UITool: false,
    defaultCatalogId: "copilotkit://flight-fixed-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-a2ui-fixed-schema/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-fixed-schema",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-a2ui-fixed-schema/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-a2ui-fixed-schema/route] Response status: ${response.status}`,
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
